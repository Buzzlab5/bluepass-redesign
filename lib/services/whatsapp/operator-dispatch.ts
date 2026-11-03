import { splitBooking } from "@/lib/services/booking/unit-economics";
import {
  buildAcceptPayload,
  buildCounterPayload,
  buildDeclinePayload,
  buildOperatorInquiryParams,
  whatsappTemplateNames,
} from "@/lib/services/whatsapp/templates";

export type DeclineReason =
  | "SOLD_OUT"
  | "WRONG_FIT"
  | "DATES_IMPOSSIBLE"
  | "OTHER"
  | "SKIPPED";

export type OperatorInquiryTemplateInput = {
  to: string;
  bookingId: string;
  inquiryTitle: string;
  travellerName: string;
  travellerPhone: string;
  dateRange: string;
  guests: string;
  quote: string;
  tripTitle: string;
  notes: string;
};

export type WhatsAppTemplatePayload = {
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: "en" };
    components: Array<
      | {
          type: "body";
          parameters: Array<{ type: "text"; text: string }>;
        }
      | {
          type: "button";
          sub_type: "quick_reply";
          index: "0" | "1" | "2";
          parameters: [{ type: "payload"; payload: string }];
        }
    >;
  };
};

export type OperatorBookingSummaryInput = {
  bookingShortCode: string;
  travellerName: string;
  travellerEmail: string;
  travellerWhatsApp: string;
  dateRange: string;
  guestCount: number;
  certificationLevel: string;
  dietaryRestrictions?: string | null;
  insuranceStatus: string;
  insurancePolicy?: string | null;
  arrivalFlight?: string | null;
  totalUsd: number;
  partnerAttributed?: boolean;
  pmsReference?: string | null;
};

export type FreeTextMessage = {
  type: "text";
  body: string;
};

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function optionalValue(value: string | null | undefined): string {
  return value?.trim() ? value : "Not provided";
}

export function buildOperatorInquiryTemplatePayload(
  input: OperatorInquiryTemplateInput,
): WhatsAppTemplatePayload {
  return {
    to: input.to,
    type: "template",
    template: {
      name: whatsappTemplateNames.bookingInquiryOperator,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: buildOperatorInquiryParams(input).map((text) => ({
            type: "text",
            text,
          })),
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "0",
          parameters: [{ type: "payload", payload: buildAcceptPayload(input.bookingId) }],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "1",
          parameters: [{ type: "payload", payload: buildDeclinePayload(input.bookingId) }],
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "2",
          parameters: [{ type: "payload", payload: buildCounterPayload(input.bookingId) }],
        },
      ],
    },
  };
}

export function buildOperatorInquiryFreeText(
  input: OperatorInquiryTemplateInput,
): FreeTextMessage {
  return {
    type: "text",
    body: [
      "New BluePass inquiry",
      "",
      `Inquiry: ${input.inquiryTitle}`,
      `Traveller: ${input.travellerName}`,
      `Traveller WhatsApp: ${input.travellerPhone}`,
      `Dates: ${input.dateRange}`,
      `Guests: ${input.guests}`,
      `Budget / quote signal: ${input.quote}`,
      `Trip: ${input.tripTitle}`,
      `Notes: ${input.notes}`,
      "",
      `Reply accept:${input.bookingId}, decline:${input.bookingId}, or counter:${input.bookingId}.`,
    ].join("\n"),
  };
}

export function buildOperatorAcceptedFreeText(
  input: OperatorBookingSummaryInput,
): FreeTextMessage {
  const split = splitBooking(input.totalUsd, input.partnerAttributed);

  return {
    type: "text",
    body: [
      `Accepted: ${input.bookingShortCode}`,
      "",
      `Traveller: ${input.travellerName}`,
      `Email: ${input.travellerEmail}`,
      `WhatsApp: ${input.travellerWhatsApp}`,
      `Dates: ${input.dateRange}`,
      `Guests: ${input.guestCount}`,
      `Certification: ${input.certificationLevel}`,
      `Dietary restrictions: ${optionalValue(input.dietaryRestrictions)}`,
      `Insurance: ${input.insuranceStatus}`,
      `Policy: ${optionalValue(input.insurancePolicy)}`,
      `Arrival flight: ${optionalValue(input.arrivalFlight)}`,
      "",
      `Total price: ${money(split.total)}`,
      `Operator net: ${money(split.operatorNet)}`,
      `BluePass commission: ${money(split.commission)}`,
      `Conservation amount: ${money(split.conservation)}`,
      `Payment processor estimate: ${money(split.stripeEstimatedFee)}`,
      `PMS reference: ${optionalValue(input.pmsReference)}`,
    ].join("\n"),
  };
}

export function buildOperatorDeclinedFreeText(input: {
  peerOperatorName: string;
}): FreeTextMessage {
  return {
    type: "text",
    body: [
      `Got it, declined. We'll route this to ${input.peerOperatorName} who has matching capacity that week.`,
      "",
      "Quick note (optional, helps our matching): why decline?",
      "1. Sold out",
      "2. Wrong fit",
      "3. Dates impossible",
      "4. Other",
      "Reply with a number or skip.",
    ].join("\n"),
  };
}

export function buildOperatorCounterPrompt(input: {
  bookingShortCode: string;
}): FreeTextMessage {
  return {
    type: "text",
    body: [
      `Counter requested for ${input.bookingShortCode}.`,
      "Reply with the counter-offer details in plain text.",
      "For now, BluePass will capture the message and prepare a structured counter flow.",
    ].join("\n"),
  };
}

export function buildOperatorAmbiguousActionPrompt(input: {
  action: string;
  inquiries: Array<{
    ref: string;
    selectedYachtName: string | null;
    dateWindow: string | null;
    guests: number | null;
  }>;
}): FreeTextMessage {
  const lines = input.inquiries.slice(0, 5).map((inquiry) => {
    const parts = [
      inquiry.ref,
      inquiry.selectedYachtName ?? "Unspecified trip",
      inquiry.dateWindow ?? "dates open",
      inquiry.guests != null ? `${inquiry.guests} guests` : null,
    ].filter(Boolean);
    return `- ${parts.join(" · ")}`;
  });

  return {
    type: "text",
    body: [
      `You have ${input.inquiries.length} pending inquiries, so a bare "${input.action}" is not enough - I have not changed anything.`,
      "Reply with the reference, e.g. " + `${input.action}:${input.inquiries[0]?.ref ?? "<ref>"}`,
      "",
      ...lines,
    ].join("\n"),
  };
}

export function buildOperatorUnknownRefPrompt(input: {
  action: string;
  ref: string;
}): FreeTextMessage {
  return {
    type: "text",
    body: [
      `I could not find a pending inquiry matching "${input.ref}" for your number, so nothing changed.`,
      `Reply ${input.action}:<reference> using one of the references from your inquiry messages.`,
    ].join("\n"),
  };
}

export function buildOperatorCounterReceived(input: {
  bookingShortCode: string;
  terms: string;
}): FreeTextMessage {
  return {
    type: "text",
    body: [
      `Counter-offer recorded for ${input.bookingShortCode}:`,
      input.terms,
      "",
      "BluePass will carry this to the traveller.",
    ].join("\n"),
  };
}
