import type { ActorPayload } from "@/lib/services/booking/orchestrator";
import {
  acceptByOperator,
  declineByOperator,
  requestCounterOffer,
} from "@/lib/services/booking/orchestrator";
import {
  InquiryActionAlreadyAppliedError,
  processOperatorInquiryAction,
  type ProcessOperatorInquiryActionResult,
} from "@/lib/services/booking/booking-inquiry-actions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { applyWhatsAppStatuses } from "@/lib/services/rails/notify";
import { maskPhoneNumber } from "@/lib/services/whatsapp/client";
import {
  buildOperatorAmbiguousActionPrompt,
  buildOperatorCounterPrompt,
  buildOperatorCounterReceived,
  buildOperatorDeclinedFreeText,
  buildOperatorUnknownRefPrompt,
  type FreeTextMessage,
} from "@/lib/services/whatsapp/operator-dispatch";
import {
  InvalidOperatorButtonPayloadError,
  parseOperatorButtonPayload,
  type OperatorButtonPayload,
} from "@/lib/services/whatsapp/payloads";
import {
  parseOperatorTextCommand,
  shortInquiryRef,
} from "@/lib/services/whatsapp/operator-text-commands";
import {
  phonesExactlyMatch,
  resolveOperatorActionTarget,
} from "@/lib/services/whatsapp/operator-action-resolution";
import {
  handleTravellerWhatsAppMessage,
  isTravellerConversationEnabled,
  type TravellerConversationDeps,
} from "@/lib/services/whatsapp/traveller-conversation";

type OrchestratorDeps = {
  acceptByOperator: (bookingId: string, actorPayload: ActorPayload) => Promise<unknown>;
  declineByOperator: (bookingId: string, actorPayload: ActorPayload) => Promise<unknown>;
  requestCounterOffer: (
    bookingId: string,
    actorPayload: ActorPayload,
  ) => Promise<unknown>;
};

type InquiryActionDeps = {
  processOperatorInquiryAction: (
    input: {
      inquiryId: string;
      action: OperatorButtonPayload["action"];
      actorPayload: ActorPayload;
      counterText?: string;
    },
  ) => Promise<ProcessOperatorInquiryActionResult>;
};

export type WhatsAppWebhookHandlerOptions = {
  orchestrator?: Partial<OrchestratorDeps>;
  inquiryActions?: Partial<InquiryActionDeps>;
  logger?: Pick<typeof console, "info" | "warn" | "error">;
  peerOperatorName?: string;
  onOperatorFollowUp?: (
    message: FreeTextMessage,
    context: { to?: string },
  ) => Promise<void> | void;
  /** Sends the traveller-side Kai reply; wired to sendWhatsAppText in the route. */
  onTravellerReply?: (
    message: FreeTextMessage,
    context: { to: string },
  ) => Promise<void> | void;
  travellerConversation?: TravellerConversationDeps;
  /** Overrides the env flag lookup, mainly for tests. */
  travellerConversationEnabled?: boolean;
  /**
   * Disables the best-effort stale-receipt recovery sweep that piggybacks on
   * inbound traffic. Tests set this and drive recoverStaleWhatsAppReceipts
   * directly so the sweep cannot race their fixtures.
   */
  skipRecoverySweep?: boolean;
};

type IncomingWhatsAppMessage = {
  id?: string;
  from?: string;
  type?: string;
  body?: string;
  buttonPayloads: string[];
};

type IncomingWhatsAppStatus = {
  id?: string;
  status?: string;
  recipientId?: string;
  timestamp?: string;
};

type IncomingMessageRoute = "operator_action" | "traveller_or_unclassified";

/** How long a claimed-but-unfinished receipt may sit before a redelivery may reprocess it. */
const STALE_RECEIPT_LEASE_MS = 5 * 60 * 1000;

const EXPECTED_INQUIRY_STATUS_BY_ACTION = {
  accept: "OPERATOR_ACCEPTED",
  decline: "OPERATOR_DECLINED",
  counter: "COUNTER_OFFERED",
} as const;

const pendingInquiryStatuses = [
  "READY_TO_DISPATCH",
  "OPERATOR_PENDING",
  "COUNTER_OFFERED",
] as const;

const defaultOrchestrator: OrchestratorDeps = {
  acceptByOperator,
  declineByOperator,
  requestCounterOffer,
};

const defaultInquiryActions: InquiryActionDeps = {
  processOperatorInquiryAction,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function addPayloadCandidate(candidates: string[], value: string | undefined) {
  const trimmed = value?.trim();
  if (trimmed && !candidates.includes(trimmed)) {
    candidates.push(trimmed);
  }
}

function getButtonPayloadCandidates(message: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const button = message.button;
  if (isRecord(button)) {
    addPayloadCandidate(candidates, asString(button.payload));
    addPayloadCandidate(candidates, asString(button.text));
  }

  const interactive = message.interactive;
  if (isRecord(interactive)) {
    const buttonReply = interactive.button_reply;
    if (isRecord(buttonReply)) {
      addPayloadCandidate(candidates, asString(buttonReply.id));
      addPayloadCandidate(candidates, asString(buttonReply.payload));
      addPayloadCandidate(candidates, asString(buttonReply.title));
    }
  }

  return candidates;
}

function maskOptionalPhone(value: string | undefined): string | null {
  return value ? maskPhoneNumber(value) : null;
}

function parseOperatorButtonPayloadCandidates(message: IncomingWhatsAppMessage): {
  parsedButton: OperatorButtonPayload;
  buttonPayloadOrText: string;
} {
  let lastError: unknown;

  for (const candidate of message.buttonPayloads) {
    try {
      return {
        parsedButton: parseOperatorButtonPayload(candidate),
        buttonPayloadOrText: candidate,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Invalid operator button payload: payload is empty.");
}

function extractIncomingMessages(payload: unknown): IncomingWhatsAppMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) {
    return [];
  }

  const messages: IncomingWhatsAppMessage[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      continue;
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) {
        continue;
      }

      const rawMessages = change.value.messages;
      if (!Array.isArray(rawMessages)) {
        continue;
      }

      for (const rawMessage of rawMessages) {
        if (!isRecord(rawMessage)) {
          continue;
        }

        const text = isRecord(rawMessage.text) ? asString(rawMessage.text.body) : undefined;
        messages.push({
          id: asString(rawMessage.id),
          from: asString(rawMessage.from),
          type: asString(rawMessage.type),
          body: text,
          buttonPayloads: getButtonPayloadCandidates(rawMessage),
        });
      }
    }
  }

  return messages;
}

function extractIncomingStatuses(payload: unknown): IncomingWhatsAppStatus[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) {
    return [];
  }

  const statuses: IncomingWhatsAppStatus[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      continue;
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) {
        continue;
      }

      const rawStatuses = change.value.statuses;
      if (!Array.isArray(rawStatuses)) {
        continue;
      }

      for (const rawStatus of rawStatuses) {
        if (!isRecord(rawStatus)) {
          continue;
        }

        statuses.push({
          id: asString(rawStatus.id),
          status: asString(rawStatus.status),
          recipientId: asString(rawStatus.recipient_id),
          timestamp: asString(rawStatus.timestamp),
        });
      }
    }
  }

  return statuses;
}

function buildActorPayload(message: IncomingWhatsAppMessage): ActorPayload {
  return {
    source: "whatsapp",
    messageType: message.type ?? "unknown",
    messageId: message.id ?? null,
    operatorWhatsApp: message.from ?? null,
  };
}

function classifyIncomingMessage(message: IncomingWhatsAppMessage): IncomingMessageRoute {
  if (message.buttonPayloads.length > 0) {
    return "operator_action";
  }
  if (message.body && parseOperatorTextCommand(message.body)) {
    return "operator_action";
  }

  return "traveller_or_unclassified";
}

type ProcessMessageDeps = {
  logger: Pick<typeof console, "info" | "warn" | "error">;
  orchestrator: OrchestratorDeps;
  inquiryActions: InquiryActionDeps;
  options: WhatsAppWebhookHandlerOptions;
};

async function processInboundWhatsAppMessage(
  message: IncomingWhatsAppMessage,
  deps: ProcessMessageDeps,
): Promise<void> {
  const { logger, orchestrator, inquiryActions, options } = deps;

  const route = classifyIncomingMessage(message);

  /*
   * In one-number MVP mode, Kai conversations and operator notifications can share
   * the same Meta phone_number_id. Inbound routing must therefore be based on the
   * sender and booking/session context instead of the destination phone number.
   * Operator actions arrive as quick-reply buttons or as the free-text commands the
   * dispatch message advertises ("Reply accept:<id>, decline:<id>, or
   * counter:<id>"); both go through the same resolution, which refuses to act for
   * senders with no dispatch/operator context and refuses to guess when more than
   * one inquiry is pending.
   */
  if (route !== "operator_action") {
    // A non-operator text may be a traveller talking to the business
    // number. Answered in-repo by the Kai conversation service when the
    // path is enabled; otherwise ignored exactly as before. When kai-core
    // is enabled the route has already forwarded the payload there, and
    // this path stays off so the traveller never gets two brains.
    const travellerEnabled =
      options.travellerConversationEnabled ?? isTravellerConversationEnabled();
    if (travellerEnabled && message.body && message.from) {
      const result = await handleTravellerWhatsAppMessage(
        { from: message.from, body: message.body },
        options.travellerConversation ?? {},
      );
      if (result.reply.trim()) {
        await options.onTravellerReply?.(
          { type: "text", body: result.reply },
          { to: message.from },
        );
      }
      logger.info("whatsapp.webhook.traveller_message_answered", {
        sender: maskOptionalPhone(message.from),
        sessionId: result.sessionId,
      });
    } else {
      logger.info("whatsapp.webhook.ignored_message", {
        messageType: message.type ?? "unknown",
        hasButtonPayload: false,
      });
    }
    return;
  }

  let action: OperatorButtonPayload["action"];
  let ref: string | null;
  let counterTerms: string | null = null;
  let buttonPayloadOrText: string | null = null;

  if (message.buttonPayloads.length > 0) {
    const parsed = parseOperatorButtonPayloadCandidates(message);
    action = parsed.parsedButton.action;
    ref = parsed.parsedButton.bookingId;
    buttonPayloadOrText = parsed.buttonPayloadOrText;
  } else {
    const textCommand = message.body ? parseOperatorTextCommand(message.body) : null;
    if (!textCommand) {
      return;
    }
    action = textCommand.action;
    ref = textCommand.ref;
    counterTerms = textCommand.terms;
  }

  const actorPayload = buildActorPayload(message);
  const target = await resolveOperatorActionTarget({
    senderPhone: message.from,
    ref,
  });

  if (target.kind === "not_operator") {
    // Default deny, and silent: a sender with no dispatch or operator context
    // learns nothing about whether a reference exists.
    logger.info("whatsapp.operator_action_without_context", {
      action,
      sender: maskOptionalPhone(message.from),
      messageId: message.id ?? null,
      buttonPayloadOrText,
    });
    return;
  }

  if (target.kind === "ambiguous") {
    await options.onOperatorFollowUp?.(
      buildOperatorAmbiguousActionPrompt({
        action,
        inquiries: target.inquiries.map((inquiry) => ({
          ref: shortInquiryRef(inquiry.id),
          selectedYachtName: inquiry.selectedYachtName,
          dateWindow: inquiry.dateWindow,
          guests: inquiry.guests,
        })),
      }),
      { to: message.from },
    );
    logger.info("whatsapp.operator_action_ambiguous", {
      action,
      sender: maskOptionalPhone(message.from),
      pendingCount: target.inquiries.length,
    });
    return;
  }

  if (target.kind === "unknown_ref") {
    await options.onOperatorFollowUp?.(
      buildOperatorUnknownRefPrompt({ action, ref: target.ref }),
      { to: message.from },
    );
    logger.info("whatsapp.operator_action_unknown_ref", {
      action,
      sender: maskOptionalPhone(message.from),
    });
    return;
  }

  if (target.kind === "none_pending") {
    logger.info("whatsapp.operator_action_without_pending", {
      action,
      sender: maskOptionalPhone(message.from),
    });
    return;
  }

  const resolvedInquiryId = target.inquiryId;

  let inquiryActionResult: ProcessOperatorInquiryActionResult;
  try {
    inquiryActionResult = await inquiryActions.processOperatorInquiryAction({
      inquiryId: resolvedInquiryId,
      action,
      actorPayload,
      counterText: counterTerms ?? undefined,
    });
  } catch (error) {
    // Recover the acknowledgement ONLY for a proven replay: the action
    // layer throws InquiryActionAlreadyAppliedError solely when the last
    // recorded event carries this delivery's providerMessageId, so that
    // event is the proof the state landed. The ack is rebuilt from the
    // recorded event itself - never from a manufactured status pair - and
    // every other failure (guard rejections, DB errors) keeps propagating.
    if (error instanceof InquiryActionAlreadyAppliedError) {
      const recordedEvent = await prisma.bookingInquiryEvent.findFirst({
        where: { bookingInquiryId: resolvedInquiryId },
        orderBy: { createdAt: "desc" },
        select: { fromStatus: true, toStatus: true },
      });
      if (
        recordedEvent?.fromStatus &&
        recordedEvent.toStatus === EXPECTED_INQUIRY_STATUS_BY_ACTION[action]
      ) {
        inquiryActionResult = {
          processed: true,
          inquiryId: resolvedInquiryId,
          fromStatus: recordedEvent.fromStatus,
          toStatus: recordedEvent.toStatus,
        };
        logger.info("whatsapp.webhook.operator_action_ack_recovered", {
          action,
          inquiryId: resolvedInquiryId,
        });
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (inquiryActionResult.processed) {
    if (action === "decline") {
      await options.onOperatorFollowUp?.(
        buildOperatorDeclinedFreeText({
          peerOperatorName: options.peerOperatorName ?? "a peer operator",
        }),
        { to: message.from },
      );
    }

    if (action === "counter") {
      await options.onOperatorFollowUp?.(
        counterTerms
          ? buildOperatorCounterReceived({
              bookingShortCode: resolvedInquiryId,
              terms: counterTerms,
            })
          : buildOperatorCounterPrompt({
              bookingShortCode: resolvedInquiryId,
            }),
        { to: message.from },
      );
    }

    logger.info("whatsapp.webhook.operator_inquiry_action_processed", {
      action,
      inquiryId: inquiryActionResult.inquiryId,
      fromStatus: inquiryActionResult.fromStatus,
      toStatus: inquiryActionResult.toStatus,
    });
    return;
  }

  // Not an inquiry id: the reference may be a rails Booking id (the older
  // button flow). Ownership still verified by the operator's WhatsApp number.
  const bookingOwnership = await prisma.booking.findUnique({
    where: { id: resolvedInquiryId },
    select: { operator: { select: { whatsappE164: true } } },
  });
  if (!bookingOwnership || !phonesExactlyMatch(bookingOwnership.operator?.whatsappE164 ?? undefined, message.from)) {
    logger.info("whatsapp.operator_action_booking_context_denied", {
      action,
      sender: maskOptionalPhone(message.from),
      messageId: message.id ?? null,
    });
    return;
  }

  if (action === "accept") {
    await orchestrator.acceptByOperator(resolvedInquiryId, actorPayload);
  }

  if (action === "decline") {
    await orchestrator.declineByOperator(resolvedInquiryId, actorPayload);
    await options.onOperatorFollowUp?.(
      buildOperatorDeclinedFreeText({
        peerOperatorName: options.peerOperatorName ?? "a peer operator",
      }),
      { to: message.from },
    );
  }

  if (action === "counter") {
    await orchestrator.requestCounterOffer(resolvedInquiryId, actorPayload);
    await options.onOperatorFollowUp?.(
      buildOperatorCounterPrompt({
        bookingShortCode: resolvedInquiryId,
      }),
      { to: message.from },
    );
  }

  logger.info("whatsapp.webhook.operator_action_processed", {
    action,
    bookingId: resolvedInquiryId,
  });

}

/**
 * Thrown when a duplicate delivery arrives while the first delivery's lease is
 * still fresh. The route must answer non-200 for it: a 200 tells Meta
 * "delivered", which can stop the redelivery that is this message's only
 * guaranteed retry before anything has committed "processed".
 */
export class WhatsAppLeaseInFlightError extends Error {
  constructor(readonly providerMessageId: string) {
    super(`WhatsApp delivery ${providerMessageId} is still being processed; redeliver later.`);
    this.name = "WhatsAppLeaseInFlightError";
  }
}

type ReceiptClaim = "fresh" | "recovered" | "duplicate";

/**
 * Claims the dedupe receipt for one inbound message. Meta redelivers webhook
 * messages, sometimes concurrently, so the receipt is claimed BEFORE acting
 * and the unique constraint decides the winner. Terminal receipts
 * ("processed"/"failed") are true duplicates and skip with a 200; a stale
 * "received" lease (a crash between claim and completion) is re-claimed
 * compare-and-set and reprocessed; a FRESH lease throws
 * WhatsAppLeaseInFlightError so the route answers non-200 and Meta keeps
 * redelivering until the receipt reaches a terminal outcome.
 */
async function claimWhatsAppInboundReceipt(message: IncomingWhatsAppMessage): Promise<ReceiptClaim> {
  if (!message.id) {
    return "fresh";
  }
  try {
    await prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: message.id,
        fromPhone: message.from ?? null,
        handler: "whatsapp.webhook",
        outcome: "received",
        // Stored so the recovery sweep can replay a stranded receipt without
        // depending on Meta ever redelivering after a 200.
        payload: {
          id: message.id,
          from: message.from ?? null,
          type: message.type ?? null,
          body: message.body ?? null,
          buttonPayloads: message.buttonPayloads ?? [],
        },
      },
    });
    return "fresh";
  } catch {
    const existing = await prisma.whatsAppInboundReceipt.findUnique({
      where: { providerMessageId: message.id },
      // Same clock as the recovery sweep: the lease ages from its last update,
      // not its original creation, so a recently re-leased or requeued receipt
      // gets its full lease window on both paths.
      select: { outcome: true, updatedAt: true },
    });
    if (existing?.outcome === "processed" || existing?.outcome === "failed") {
      return "duplicate";
    }
    const stale =
      existing?.outcome === "received" &&
      existing.updatedAt.getTime() < Date.now() - STALE_RECEIPT_LEASE_MS;
    if (stale) {
      const lease = await prisma.whatsAppInboundReceipt.updateMany({
        where: { providerMessageId: message.id, outcome: "received" },
        data: { outcome: "reprocessing", attempts: { increment: 1 } },
      });
      if (lease.count === 1) {
        return "recovered";
      }
    }
    throw new WhatsAppLeaseInFlightError(message.id);
  }
}

/** A "failed" receipt gets another chance after this longer backoff. */
const FAILED_RECEIPT_RETRY_MS = 30 * 60 * 1000;
/** Bounded recovery: at this many attempts a receipt stays "failed" and is logged as an error. */
const MAX_RECEIPT_ATTEMPTS = 5;
const RECOVERY_BATCH_SIZE = 20;

function isRecoverableMessage(payload: unknown): payload is IncomingWhatsAppMessage {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.from === "string" &&
    typeof candidate.type === "string"
  );
}

/**
 * Replays inbound messages whose receipts are stranded in a non-terminal
 * outcome. This is what makes crash recovery real rather than
 * Meta-retry-dependent: Meta only redelivers on a non-200, so a crash after a
 * 200 (or a lost redelivery) would strand a receipt forever if nothing went
 * looking. The sweep runs piggybacked on inbound traffic and can also be
 * invoked from a scheduled route. Each replay takes an attempts-incremented
 * compare-and-set lease so concurrent sweepers never double-process. A
 * replay that fails returns to "received" for the next sweep until
 * MAX_RECEIPT_ATTEMPTS, then stays "failed" with an error log - visible, not
 * silent - and is re-queued after FAILED_RECEIPT_RETRY_MS.
 *
 * Known limitation, deliberately accepted: acknowledgement/follow-up sends
 * are at-least-once. A crash after the send but before the receipt settles
 * (or a stale-lease reclaim racing a slow first delivery) can re-send an
 * operator ack or prompt. State transitions themselves are guarded by the
 * inquiry status machine and the event log, so they never double-apply.
 */
export async function recoverStaleWhatsAppReceipts(
  options: WhatsAppWebhookHandlerOptions = {},
): Promise<{ reprocessed: number; failed: number }> {
  const logger = options.logger ?? console;
  const deps: ProcessMessageDeps = {
    logger,
    orchestrator: { ...defaultOrchestrator, ...options.orchestrator },
    inquiryActions: { ...defaultInquiryActions, ...options.inquiryActions },
    options,
  };
  const now = Date.now();
  const staleBefore = new Date(now - STALE_RECEIPT_LEASE_MS);
  const retryFailedBefore = new Date(now - FAILED_RECEIPT_RETRY_MS);

  await prisma.whatsAppInboundReceipt.updateMany({
    where: {
      outcome: "failed",
      attempts: { lt: MAX_RECEIPT_ATTEMPTS },
      updatedAt: { lte: retryFailedBefore },
    },
    data: { outcome: "received" },
  });

  const stale = await prisma.whatsAppInboundReceipt.findMany({
    where: {
      outcome: { in: ["received", "reprocessing"] },
      updatedAt: { lte: staleBefore },
    },
    orderBy: { updatedAt: "asc" },
    take: RECOVERY_BATCH_SIZE,
  });

  let reprocessed = 0;
  let failed = 0;
  for (const receipt of stale) {
    const lease = await prisma.whatsAppInboundReceipt.updateMany({
      where: {
        id: receipt.id,
        outcome: { in: ["received", "reprocessing"] },
        attempts: receipt.attempts,
      },
      data: { outcome: "reprocessing", attempts: { increment: 1 } },
    });
    if (lease.count === 0) {
      continue; // another sweeper claimed it first
    }
    const attemptsMade = receipt.attempts + 1;
    const payload: unknown = receipt.payload;
    if (!isRecoverableMessage(payload)) {
      logger.error("whatsapp.webhook.receipt_without_replayable_payload", {
        providerMessageId: receipt.providerMessageId,
      });
      await prisma.whatsAppInboundReceipt.updateMany({
        where: { id: receipt.id, outcome: "reprocessing" },
        data: { outcome: "failed" },
      });
      failed += 1;
      continue;
    }
    try {
      await processInboundWhatsAppMessage(payload, deps);
      await prisma.whatsAppInboundReceipt.updateMany({
        where: { id: receipt.id, outcome: "reprocessing" },
        data: { outcome: "processed", processedAt: new Date(), payload: Prisma.JsonNull },
      });
      reprocessed += 1;
    } catch (error) {
      const terminal = attemptsMade >= MAX_RECEIPT_ATTEMPTS;
      if (terminal) {
        logger.error("whatsapp.webhook.receipt_recovery_exhausted", {
          providerMessageId: receipt.providerMessageId,
          attempts: attemptsMade,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      await prisma.whatsAppInboundReceipt.updateMany({
        where: { id: receipt.id, outcome: "reprocessing" },
        // A permanently failed receipt can never be replayed, so its stored
        // message copy is dropped with it; only the terminal marker stays.
        data: terminal
          ? { outcome: "failed", payload: Prisma.JsonNull }
          : { outcome: "received" },
      });
      failed += 1;
    }
  }
  return { reprocessed, failed };
}

export async function handleWhatsAppWebhook(
  payload: unknown,
  options: WhatsAppWebhookHandlerOptions = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const orchestrator = {
    ...defaultOrchestrator,
    ...options.orchestrator,
  };
  const inquiryActions = {
    ...defaultInquiryActions,
    ...options.inquiryActions,
  };

  const parsedPayload =
    typeof payload === "string" ? (JSON.parse(payload) as unknown) : payload;

  await handleWhatsAppStatuses(extractIncomingStatuses(parsedPayload), logger);
  // Receipts for booking-CMS messages live in their own log; this leaves the inquiry
  // flow's handling above exactly as it was.
  await applyWhatsAppStatuses(parsedPayload).catch((error) => {
    logger.warn("whatsapp.webhook.rails_status_failed", {
      reason: error instanceof Error ? error.message : "Unknown status error.",
    });
  });

  const messages = extractIncomingMessages(parsedPayload);

  const deps: ProcessMessageDeps = { logger, orchestrator, inquiryActions, options };

  // Best-effort crash recovery, piggybacked on inbound traffic; never blocks
  // or fails the inbound request.
  if (!options.skipRecoverySweep) {
    void recoverStaleWhatsAppReceipts(options).catch((error) =>
      logger.warn("whatsapp.webhook.receipt_sweep_failed", {
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  let freshFailures = 0;
  let leaseInFlight = 0;
  for (const message of messages) {
    let claim: ReceiptClaim = "fresh";
    try {
      claim = await claimWhatsAppInboundReceipt(message);
      if (claim === "duplicate") {
        logger.info("whatsapp.webhook.duplicate_message", {
          sender: maskOptionalPhone(message.from),
        });
        continue;
      }
      await processInboundWhatsAppMessage(message, deps);
      if (message.id) {
        await prisma.whatsAppInboundReceipt
          .updateMany({
            where: { providerMessageId: message.id },
            // Terminal: drop the stored message copy (sender + body) so the
            // receipt log does not retain message contents indefinitely.
            data: { outcome: "processed", processedAt: new Date(), payload: Prisma.JsonNull },
          })
          .catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof WhatsAppLeaseInFlightError) {
        // Receipt deliberately untouched; the non-200 keeps Meta redelivering.
        leaseInFlight += 1;
        logger.info("whatsapp.webhook.delivery_lease_in_flight", {
          sender: maskOptionalPhone(message.from),
        });
        continue;
      }
      if (error instanceof InvalidOperatorButtonPayloadError) {
        // Permanent: this payload fails every retry identically, so a non-200
        // would loop Meta redeliveries forever with no terminal record. Mark
        // the receipt failed at the attempt cap (the sweep never replays it),
        // scrub the stored payload like a processed receipt, log visibly, and
        // let the route answer 200. No inquiry or booking state is touched.
        if (message.id) {
          await prisma.whatsAppInboundReceipt
            .updateMany({
              where: {
                providerMessageId: message.id,
                outcome: { in: ["received", "reprocessing"] },
              },
              data: {
                outcome: "failed",
                attempts: MAX_RECEIPT_ATTEMPTS,
                payload: Prisma.JsonNull,
              },
            })
            .catch(() => undefined);
        }
        logger.error("whatsapp.webhook.permanent_failure", {
          messageType: message.type ?? "unknown",
          reason: error.message,
        });
        continue;
      }
      if (message.id) {
        if (claim === "recovered") {
          // A recovered delivery that fails again stays receipted as "failed":
          // visible for inspection and eligible for the recovery sweep, not
          // looping on every Meta retry.
          await prisma.whatsAppInboundReceipt
            .updateMany({ where: { providerMessageId: message.id }, data: { outcome: "failed" } })
            .catch(() => undefined);
        } else {
          // Un-receipt a first-attempt failure so Meta's retry is processed, not skipped.
          freshFailures += 1;
          await prisma.whatsAppInboundReceipt
            .deleteMany({ where: { providerMessageId: message.id } })
            .catch(() => undefined);
        }
      } else {
        freshFailures += 1;
      }
      logger.warn("whatsapp.webhook.message_failed", {
        messageType: message.type ?? "unknown",
        reason: error instanceof Error ? error.message : "Unknown webhook error.",
      });
    }
  }

  // A 200 tells Meta "delivered". Fresh failures are un-receipted and in-flight
  // leases are left alone, but Meta only retries on a non-200 - so the handler
  // must fail loudly in both cases or the message is lost with no trace.
  if (freshFailures > 0 || leaseInFlight > 0) {
    throw new Error(
      `${freshFailures + leaseInFlight} webhook message(s) need Meta redelivery ` +
        `(un-receipted fresh failures: ${freshFailures}, deliveries awaiting an in-flight lease: ${leaseInFlight}).`,
    );
  }
}

async function handleWhatsAppStatuses(
  statuses: IncomingWhatsAppStatus[],
  logger: Pick<typeof console, "info" | "warn" | "error">,
) {
  for (const status of statuses) {
    if (!status.id || !status.status) {
      continue;
    }

    try {
      const updated = await prisma.whatsAppOutboundMessage.updateMany({
        where: { providerMessageId: status.id },
        data: {
          status: status.status === "failed" ? "FAILED" : "SENT",
          sentAt: status.status === "sent" ? statusTimestamp(status.timestamp) : undefined,
        },
      });

      logger.info("whatsapp.webhook.status_processed", {
        providerMessageId: "present",
        status: status.status,
        recipient: maskOptionalPhone(status.recipientId),
        matchedOutboundMessages: updated.count,
      });
    } catch (error) {
      logger.warn("whatsapp.webhook.status_failed", {
        providerMessageId: "present",
        status: status.status,
        reason: error instanceof Error ? error.message : "Unknown status webhook error.",
      });
    }
  }
}

function statusTimestamp(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);

  return Number.isFinite(seconds) ? new Date(seconds * 1000) : undefined;
}
