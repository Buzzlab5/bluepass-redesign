import type { ActorPayload } from "@/lib/services/booking/orchestrator";
import {
  acceptByOperator,
  declineByOperator,
  requestCounterOffer,
} from "@/lib/services/booking/orchestrator";
import {
  processOperatorInquiryAction,
  type ProcessOperatorInquiryActionResult,
} from "@/lib/services/booking/booking-inquiry-actions";
import { prisma } from "@/lib/db/prisma";
import { applyWhatsAppStatuses } from "@/lib/services/rails/notify";
import { maskPhoneNumber } from "@/lib/services/whatsapp/client";
import {
  buildOperatorCounterPrompt,
  buildOperatorDeclinedFreeText,
  type FreeTextMessage,
} from "@/lib/services/whatsapp/operator-dispatch";
import {
  parseOperatorButtonPayload,
  type OperatorButtonPayload,
} from "@/lib/services/whatsapp/payloads";

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
};

type IncomingWhatsAppMessage = {
  id?: string;
  from?: string;
  type?: string;
  buttonPayloads: string[];
};

type IncomingWhatsAppStatus = {
  id?: string;
  status?: string;
  recipientId?: string;
  timestamp?: string;
};

type IncomingMessageRoute = "operator_action" | "traveller_or_unclassified";

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

        messages.push({
          id: asString(rawMessage.id),
          from: asString(rawMessage.from),
          type: asString(rawMessage.type),
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

  return "traveller_or_unclassified";
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

  for (const message of messages) {
    try {
      const route = classifyIncomingMessage(message);

      /*
       * In one-number MVP mode, Kai conversations and operator notifications can share
       * the same Meta phone_number_id. Inbound routing must therefore be based on the
       * sender and booking/session context instead of the destination phone number:
       * if the sender matches an Operator.whatsappNumber or has an active operator
       * action context, route to operator flow; otherwise route to traveller Kai flow.
       * Sprint 2 only supports operator button payloads, so quick replies remain
       * operator actions regardless of the destination phone_number_id.
       */
      if (route !== "operator_action" || message.buttonPayloads.length === 0) {
        logger.info("whatsapp.webhook.ignored_message", {
          messageType: message.type ?? "unknown",
          hasButtonPayload: false,
        });
        continue;
      }

      const { parsedButton, buttonPayloadOrText } =
        parseOperatorButtonPayloadCandidates(message);
      const actorPayload = buildActorPayload(message);

      const resolvedInquiryId =
        parsedButton.bookingId ??
        (await resolveLatestPendingInquiryIdForOperatorReply({
          senderPhone: message.from,
          logger,
        }));

      if (!resolvedInquiryId) {
        logger.info("whatsapp.operator_button_without_booking_context", {
          action: parsedButton.action,
          sender: maskOptionalPhone(message.from),
          messageId: message.id ?? null,
          buttonPayloadOrText,
          note: "Unable to resolve a pending inquiry for this operator reply.",
        });
        continue;
      }

      const inquiryActionResult =
        await inquiryActions.processOperatorInquiryAction({
          inquiryId: resolvedInquiryId,
          action: parsedButton.action,
          actorPayload,
        });

      if (inquiryActionResult.processed) {
        if (parsedButton.action === "decline") {
          await options.onOperatorFollowUp?.(
            buildOperatorDeclinedFreeText({
              peerOperatorName: options.peerOperatorName ?? "a peer operator",
            }),
            { to: message.from },
          );
        }

        if (parsedButton.action === "counter") {
          await options.onOperatorFollowUp?.(
            buildOperatorCounterPrompt({
              bookingShortCode: resolvedInquiryId,
            }),
            { to: message.from },
          );
        }

        logger.info("whatsapp.webhook.operator_inquiry_action_processed", {
          action: parsedButton.action,
          inquiryId: inquiryActionResult.inquiryId,
          fromStatus: inquiryActionResult.fromStatus,
          toStatus: inquiryActionResult.toStatus,
        });
        continue;
      }

      if (parsedButton.action === "accept") {
        await orchestrator.acceptByOperator(resolvedInquiryId, actorPayload);
      }

      if (parsedButton.action === "decline") {
        await orchestrator.declineByOperator(resolvedInquiryId, actorPayload);
        await options.onOperatorFollowUp?.(
          buildOperatorDeclinedFreeText({
            peerOperatorName: options.peerOperatorName ?? "a peer operator",
          }),
          { to: message.from },
        );
      }

      if (parsedButton.action === "counter") {
        await orchestrator.requestCounterOffer(resolvedInquiryId, actorPayload);
        await options.onOperatorFollowUp?.(
          buildOperatorCounterPrompt({
            bookingShortCode: resolvedInquiryId,
          }),
          { to: message.from },
        );
      }

      logger.info("whatsapp.webhook.operator_action_processed", {
        action: parsedButton.action,
        bookingId: resolvedInquiryId,
      });
    } catch (error) {
      logger.warn("whatsapp.webhook.message_failed", {
        messageType: message.type ?? "unknown",
        reason: error instanceof Error ? error.message : "Unknown webhook error.",
      });
    }
  }
}

async function resolveLatestPendingInquiryIdForOperatorReply(input: {
  senderPhone?: string;
  logger: Pick<typeof console, "info" | "warn" | "error">;
}) {
  const recipientPhone = normalizePhoneDigits(input.senderPhone);

  if (!recipientPhone) {
    return undefined;
  }

  const outbound = await prisma.whatsAppOutboundMessage.findFirst({
    where: {
      recipientPhone,
      bookingInquiry: {
        status: { in: [...pendingInquiryStatuses] },
      },
    },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    select: {
      bookingInquiryId: true,
      bookingInquiry: {
        select: { id: true, status: true },
      },
    },
  });

  if (!outbound) {
    input.logger.info("whatsapp.operator_button_context_not_found", {
      sender: maskOptionalPhone(input.senderPhone),
    });
    return undefined;
  }

  input.logger.info("whatsapp.operator_button_context_resolved", {
    sender: maskOptionalPhone(input.senderPhone),
    inquiryId: outbound.bookingInquiryId,
    inquiryStatus: outbound.bookingInquiry.status,
  });

  return outbound.bookingInquiryId;
}

function normalizePhoneDigits(value: string | undefined) {
  const digits = value?.replace(/[^\d]/g, "") ?? "";

  return digits.length > 0 ? digits : undefined;
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
