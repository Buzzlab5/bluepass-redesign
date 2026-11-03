import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { yachtBySlug } from "@/lib/data/yachts";
import { sanitizeJsonForPrisma } from "@/lib/services/kai/json-safety";
import {
  sendTemplateMessage,
  sendWhatsAppText,
} from "@/lib/services/whatsapp/client";
import {
  buildOperatorInquiryFreeText,
  buildOperatorInquiryTemplatePayload,
  type OperatorInquiryTemplateInput,
} from "@/lib/services/whatsapp/operator-dispatch";
import { whatsappTemplateNames } from "@/lib/services/whatsapp/templates";
import { toStorageE164 } from "@/lib/phone";

const operatorInquirySendMode = {
  template: "template",
  text: "text",
} as const;

export type DispatchInquiryToOperatorInput = {
  inquiryId: string;
  operatorPhone: string;
  operatorId?: string;
};

export async function dispatchInquiryToOperator(
  input: DispatchInquiryToOperatorInput,
) {
  const inquiry = await prisma.bookingInquiry.findUniqueOrThrow({
    where: { id: input.inquiryId },
  });
  /* Canonical marker-preserving storage: recipientPhone is what the webhook
     authorization comparison reads, so it is stored only as E.164. The Meta
     send address stays digits-only, as the API requires. */
  const recipientPhone = toStorageE164(input.operatorPhone);
  if (!recipientPhone) {
    throw new Error(
      `Cannot dispatch inquiry ${input.inquiryId}: the operator phone is not a recognisable number.`,
    );
  }
  const templateInput = buildInquiryTemplateInput({
    inquiry,
    operatorPhone: recipientPhone,
  });
  const template = buildOperatorInquiryTemplatePayload(templateInput);
  const outbound = await prisma.whatsAppOutboundMessage.create({
    data: {
      bookingInquiryId: inquiry.id,
      operatorId: input.operatorId ?? inquiry.operatorId,
      recipientPhone,
      templateName: whatsappTemplateNames.bookingInquiryOperator,
      status: "QUEUED",
      metadata: sanitizeJsonForPrisma({
        selectedYachtSlug: inquiry.selectedYachtSlug,
        selectedYachtName: inquiry.selectedYachtName,
        templateInput,
      }) as Prisma.InputJsonValue,
    },
  });

  const sendResult = await sendOperatorInquiryMessage({
    to: template.to,
    templateName: template.template.name,
    languageCode: template.template.language.code,
    components: template.template.components,
    textBody: buildOperatorInquiryFreeText(templateInput).body,
  }).catch(async (error: unknown) => {
    await prisma.whatsAppOutboundMessage.update({
      where: { id: outbound.id },
      data: { status: "FAILED" },
    });

    throw error;
  });

  await prisma.whatsAppOutboundMessage.update({
    where: { id: outbound.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      templateName:
        sendResult.messageKind === "text"
          ? "operator_inquiry_text"
          : outbound.templateName,
      providerMessageId: sendResult.providerMessageId,
    },
  });

  const updatedInquiry = await prisma.bookingInquiry.update({
    where: { id: inquiry.id },
    data: {
      status: "OPERATOR_PENDING",
      operatorId: input.operatorId ?? inquiry.operatorId,
    },
  });

  return {
    ok: true as const,
    inquiryId: updatedInquiry.id,
    status: updatedInquiry.status,
    providerMessageId: sendResult.providerMessageId,
    outboundMessageId: outbound.id,
  };
}

async function sendOperatorInquiryMessage(input: {
  to: string;
  templateName: string;
  languageCode: string;
  components: Parameters<typeof sendTemplateMessage>[0]["components"];
  textBody: string;
}): Promise<{
  messageKind: "template" | "text";
  providerMessageId: string | null;
}> {
  if (resolveOperatorInquirySendMode() === operatorInquirySendMode.text) {
    const result = await sendWhatsAppText({
      to: input.to,
      role: "ops",
      body: input.textBody,
    });

    return { messageKind: "text", providerMessageId: result.providerMessageId };
  }

  try {
    const result = await sendTemplateMessage({
      to: input.to,
      role: "ops",
      name: input.templateName,
      languageCode: input.languageCode,
      components: input.components,
    });

    return {
      messageKind: "template",
      providerMessageId: result.providerMessageId,
    };
  } catch {
    const result = await sendWhatsAppText({
      to: input.to,
      role: "ops",
      body: input.textBody,
    });

    return { messageKind: "text", providerMessageId: result.providerMessageId };
  }
}

function resolveOperatorInquirySendMode() {
  return process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE ===
    operatorInquirySendMode.template
    ? operatorInquirySendMode.template
    : operatorInquirySendMode.text;
}

export function buildInquiryTemplateInput(input: {
  inquiry: {
    id: string;
    selectedYachtSlug: string | null;
    selectedYachtName: string | null;
    travellerName: string | null;
    travellerPhone: string | null;
    destination: string | null;
    tripType: string | null;
    dateWindow: string | null;
    guests: number | null;
    certificationLevel: string | null;
    budget: string | null;
    notes: string | null;
    referralCode: string | null;
    referralRole: string | null;
  };
  operatorPhone: string;
}): OperatorInquiryTemplateInput {
  const yacht = input.inquiry.selectedYachtSlug
    ? yachtBySlug[input.inquiry.selectedYachtSlug]
    : undefined;
  const selectedYachtName = input.inquiry.selectedYachtName ?? yacht?.name;
  const tripTitle = selectedYachtName
    ? `${selectedYachtName} inquiry`
    : `${input.inquiry.destination ?? "Indonesia"} inquiry`;
  const inquiryTitle = [
    input.inquiry.destination,
    input.inquiry.tripType,
    input.inquiry.guests ? `${input.inquiry.guests} guests` : undefined,
  ]
    .filter(Boolean)
    .join(" / ");
  const notes = [
    input.inquiry.notes,
    input.inquiry.certificationLevel
      ? `Certification: ${input.inquiry.certificationLevel}`
      : undefined,
    input.inquiry.selectedYachtSlug
      ? `Selected yacht: ${input.inquiry.selectedYachtSlug}`
      : undefined,
    input.inquiry.referralCode
      ? `Referral: ${formatReferralSource(input.inquiry.referralCode, input.inquiry.referralRole)}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" | ");

  /* The Meta send target is derived from the canonical storage value, never
     from raw input: a national "0412..." sent as-is is a wrong address Meta
     rejects. Digits-only on the wire, as the API requires; the stored
     recipientPhone keeps its "+" marker as canonical provenance. */
  const canonicalTo = toStorageE164(input.operatorPhone);
  if (!canonicalTo) {
    throw new Error(
      `Cannot build an operator dispatch for inquiry ${input.inquiry.id}: the operator phone is not a recognisable number.`,
    );
  }

  return {
    to: canonicalTo.replace(/\D/g, ""),
    bookingId: input.inquiry.id,
    inquiryTitle: inquiryTitle || "BluePass yacht inquiry",
    travellerName: input.inquiry.travellerName ?? "BluePass traveller",
    travellerPhone: input.inquiry.travellerPhone ?? "Not provided",
    dateRange: input.inquiry.dateWindow ?? "Not provided",
    guests: input.inquiry.guests
      ? String(input.inquiry.guests)
      : "Not provided",
    quote: input.inquiry.budget ?? "Quote requested",
    tripTitle,
    notes: notes || "No additional notes",
  };
}

function formatReferralSource(code: string, role?: string | null) {
  return role ? `${role.toLowerCase()} / ${code}` : code;
}

