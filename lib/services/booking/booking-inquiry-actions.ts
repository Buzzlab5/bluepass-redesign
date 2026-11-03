import type { ActorType, BookingInquiryStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { OperatorButtonAction } from "@/lib/services/whatsapp/payloads";

const jsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const actorPayloadSchema = z.record(z.string(), jsonScalarSchema).default({});

/**
 * Thrown only when the recorded event log PROVES this exact delivery already
 * landed: the inquiry sits in the action's target status and the latest event
 * carries this delivery's providerMessageId. The webhook layer catches this
 * specific error to re-send a lost acknowledgement; every other failure
 * (guard rejections, DB errors) must keep propagating so it is neither masked
 * nor "recovered" into a fabricated audit pair.
 */
export class InquiryActionAlreadyAppliedError extends Error {
  constructor(
    readonly inquiryStatus: string,
    readonly targetStatus: string,
  ) {
    super(`Inquiry action already applied: ${inquiryStatus} is already ${targetStatus}.`);
    this.name = "InquiryActionAlreadyAppliedError";
  }
}

const inquiryActionStatus: Record<OperatorButtonAction, BookingInquiryStatus> = {
  accept: "OPERATOR_ACCEPTED",
  decline: "OPERATOR_DECLINED",
  counter: "COUNTER_OFFERED",
};

const actionableStatuses: BookingInquiryStatus[] = [
  "READY_TO_DISPATCH",
  "OPERATOR_PENDING",
  "COUNTER_OFFERED",
];

export type ProcessOperatorInquiryActionInput = {
  inquiryId: string;
  action: OperatorButtonAction;
  actorPayload?: Prisma.InputJsonObject;
  /** Plain-text counter terms when the operator sent them with the action. */
  counterText?: string;
};

export type ProcessOperatorInquiryActionResult =
  | {
      processed: true;
      inquiryId: string;
      fromStatus: BookingInquiryStatus;
      toStatus: BookingInquiryStatus;
    }
  | {
      processed: false;
      reason: "not_found";
    };

export async function processOperatorInquiryAction(
  input: ProcessOperatorInquiryActionInput,
): Promise<ProcessOperatorInquiryActionResult> {
  const parsedPayload = actorPayloadSchema.parse(
    input.actorPayload ?? {},
  ) as Prisma.InputJsonObject;
  const toStatus = inquiryActionStatus[input.action];

  return prisma.$transaction(async (tx) => {
    const inquiry = await tx.bookingInquiry.findUnique({
      where: { id: input.inquiryId },
      select: { id: true, status: true },
    });

    if (!inquiry) {
      return {
        processed: false as const,
        reason: "not_found" as const,
      };
    }

    if (inquiry.status === toStatus) {
      // Same status as the target: a redelivery replaying the very message
      // that landed the action must not write a second event - the webhook
      // layer recognises this and re-sends only the acknowledgement that may
      // have been lost. A genuinely NEW message (different providerMessageId,
      // e.g. an operator revising counter terms) is a real event and proceeds.
      const incomingMessageId =
        typeof parsedPayload.messageId === "string" ? parsedPayload.messageId : null;
      const lastEvent = await tx.bookingInquiryEvent.findFirst({
        where: { bookingInquiryId: inquiry.id },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      });
      const lastMessageId =
        lastEvent?.payload &&
        typeof lastEvent.payload === "object" &&
        !Array.isArray(lastEvent.payload) &&
        typeof (lastEvent.payload as Record<string, unknown>).messageId === "string"
          ? ((lastEvent.payload as Record<string, unknown>).messageId as string)
          : null;
      if (incomingMessageId && lastMessageId && incomingMessageId === lastMessageId) {
        throw new InquiryActionAlreadyAppliedError(inquiry.status, toStatus);
      }
    }

    if (!actionableStatuses.includes(inquiry.status)) {
      throw new Error(
        `Invalid inquiry status transition: ${inquiry.status} -> ${toStatus}`,
      );
    }

    const updated = await tx.bookingInquiry.update({
      where: { id: inquiry.id },
      data: { status: toStatus },
      select: { id: true, status: true },
    });

    await tx.bookingInquiryEvent.create({
      data: {
        bookingInquiryId: inquiry.id,
        fromStatus: inquiry.status,
        toStatus: updated.status,
        actorType: "OPERATOR" satisfies ActorType,
        payload: {
          ...parsedPayload,
          action: input.action,
          ...(input.counterText?.trim() ? { counterText: input.counterText.trim() } : {}),
        },
      },
    });

    return {
      processed: true as const,
      inquiryId: updated.id,
      fromStatus: inquiry.status,
      toStatus: updated.status,
    };
  });
}
