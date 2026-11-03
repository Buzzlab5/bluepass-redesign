/**
 * Resolves which inquiry an operator's WhatsApp reply acts on - and whether
 * that sender may act on it at all.
 *
 * Two rules the button-only handler lacked:
 *
 * Default-deny ownership: an action only lands when the sender's phone is the
 * inquiry operator's WhatsApp number or the phone the dispatch was sent to.
 * Anyone else who learns an inquiry id gets silence, never a state change.
 *
 * Ambiguity refused, never guessed: a bare "accept" with more than one pending
 * inquiry for the sender is answered with the list of references to reply
 * with, and nothing changes. The old path quietly picked the latest.
 */
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_COUNTRY_ISO, findCountryByDial, findCountryByIso } from "@/lib/countries";
import { parsePhoneInput, toE164 } from "@/lib/phone";

export const ACTIONABLE_INQUIRY_STATUSES = [
  "READY_TO_DISPATCH",
  "OPERATOR_PENDING",
  "COUNTER_OFFERED",
] as const;

export type PendingInquirySummary = {
  id: string;
  selectedYachtName: string | null;
  dateWindow: string | null;
  guests: number | null;
  status: string;
};

export type OperatorActionTarget =
  | { kind: "resolved"; inquiryId: string }
  | { kind: "none_pending" }
  | { kind: "unknown_ref"; ref: string }
  | { kind: "ambiguous"; inquiries: PendingInquirySummary[] }
  | { kind: "not_operator" };

export function normalizeSenderDigits(value: string | undefined): string | undefined {
  const digits = value?.replace(/[^\d]/g, "") ?? "";
  return digits.length > 0 ? digits : undefined;
}

/**
 * The two parsing roles are deliberately distinct, each grounded in its own
 * source semantics - never one shared guess.
 *
 * Meta sender: Meta delivers the webhook sender as full international digits
 * with no "+" ("61412..."), so dial-code detection is grounded in the source
 * format. A value with no known dial code cannot be a Meta sender and
 * resolves to "".
 */
function canonicalMetaSenderE164(metaSender: string | undefined): string {
  const digits = metaSender?.replace(/\D/g, "") ?? "";
  if (!digits) {
    return "";
  }
  const country = findCountryByDial(digits);
  if (!country) {
    return "";
  }
  return toE164(country, digits.slice(country.dial.length).replace(/^0+/, ""));
}

/**
 * Stored value: only grounded forms canonicalize.
 * - "+..."/"00..." values carry their own country (parsePhoneInput adopts
 *   it) - this is the only form the repo's write paths store (toStorageE164);
 * - a leading "0" is a national trunk prefix, read under the project default
 *   country - the convention bookings.ts already applies, deliberately not
 *   widened: a non-AU local-format number ("0812...") fails CLOSED until it
 *   is stored in E.164, as the whatsappE164 field demands;
 * - any OTHER bare digits are ambiguous and REJECTED: a national number
 *   entered without its trunk prefix can have leading digits that form
 *   another country's dial code ("412345678" would otherwise dial-detect as
 *   Swiss and hand a foreign subscriber operator authority). Legacy rows
 *   written before marker-preserving storage deny safely; rewriting them is
 *   an audited data migration, a deployment prerequisite reported separately.
 */
function canonicalStoredE164(value: string | undefined): string {
  if (!value?.trim()) {
    return "";
  }
  const fallback = findCountryByIso(DEFAULT_COUNTRY_ISO);
  if (!fallback) {
    return "";
  }
  if (/^\s*(\+|00)/.test(value)) {
    const parsed = parsePhoneInput(value, fallback);
    return toE164(parsed.country, parsed.national);
  }
  const digits = value.replace(/\D/g, "");
  if (!digits.startsWith("0")) {
    return "";
  }
  return toE164(fallback, digits.replace(/^0+/, ""));
}

/**
 * Authorization comparison: EXACT match of the two canonical E.164 forms,
 * each parsed by its own grounded role. No raw-digit shortcut (two identical
 * garbage strings must not match), no suffix or partial matching, and no
 * dial-detecting ambiguous stored values - anything that cannot be
 * canonicalized with confidence denies.
 */
export function phonesExactlyMatch(
  storedValue: string | undefined,
  metaSender: string | undefined,
): boolean {
  const stored = canonicalStoredE164(storedValue);
  const sender = canonicalMetaSenderE164(metaSender);
  return Boolean(stored) && Boolean(sender) && stored === sender;
}

async function listPendingInquiriesForSender(
  senderDigits: string,
): Promise<PendingInquirySummary[]> {
  // recipientPhone was stored in whatever format the dispatch was given
  // (digits-only), so a DB-side equality would miss local-format storage.
  // Pending dispatches are few; filter with the format-tolerant comparison.
  const outbound = await prisma.whatsAppOutboundMessage.findMany({
    where: {
      bookingInquiry: { status: { in: [...ACTIONABLE_INQUIRY_STATUSES] } },
    },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      recipientPhone: true,
      bookingInquiry: {
        select: {
          id: true,
          selectedYachtName: true,
          dateWindow: true,
          guests: true,
          status: true,
        },
      },
    },
  });

  const seen = new Set<string>();
  const summaries: PendingInquirySummary[] = [];
  for (const row of outbound) {
    if (!phonesExactlyMatch(row.recipientPhone, senderDigits)) {
      continue;
    }
    if (!seen.has(row.bookingInquiry.id)) {
      seen.add(row.bookingInquiry.id);
      summaries.push(row.bookingInquiry);
    }
  }
  return summaries;
}

async function senderMayActOnInquiry(input: {
  senderDigits: string;
  inquiryId: string;
}): Promise<boolean> {
  const outboundForInquiry = await prisma.whatsAppOutboundMessage.findMany({
    where: { bookingInquiryId: input.inquiryId },
    select: { recipientPhone: true },
    take: 20,
  });
  if (outboundForInquiry.some((row) => phonesExactlyMatch(row.recipientPhone, input.senderDigits))) {
    return true;
  }

  const inquiry = await prisma.bookingInquiry.findUnique({
    where: { id: input.inquiryId },
    select: { operator: { select: { whatsappE164: true } } },
  });
  return phonesExactlyMatch(inquiry?.operator?.whatsappE164 ?? undefined, input.senderDigits);
}

export async function resolveOperatorActionTarget(input: {
  senderPhone?: string;
  ref?: string | null;
}): Promise<OperatorActionTarget> {
  const senderDigits = normalizeSenderDigits(input.senderPhone);
  if (!senderDigits) {
    return { kind: "not_operator" };
  }

  if (input.ref) {
    // Full id first; otherwise a suffix match, but only among this sender's own
    // pending inquiries and only when exactly one matches.
    const byId = await prisma.bookingInquiry.findUnique({
      where: { id: input.ref },
      select: { id: true },
    });
    if (byId) {
      const allowed = await senderMayActOnInquiry({ senderDigits, inquiryId: byId.id });
      return allowed ? { kind: "resolved", inquiryId: byId.id } : { kind: "not_operator" };
    }

    // Not an inquiry: the reference may be a rails Booking id (the older button
    // flow). Ownership is the booking operator's own WhatsApp number.
    const booking = await prisma.booking.findUnique({
      where: { id: input.ref },
      select: { id: true, operator: { select: { whatsappE164: true } } },
    });
    if (booking) {
      return phonesExactlyMatch(booking.operator?.whatsappE164 ?? undefined, senderDigits)
        ? { kind: "resolved", inquiryId: booking.id }
        : { kind: "not_operator" };
    }

    const pending = await listPendingInquiriesForSender(senderDigits);
    const refLower = input.ref.toLowerCase();
    const matches = pending.filter((inquiry) => inquiry.id.toLowerCase().endsWith(refLower));
    if (matches.length === 1) {
      return { kind: "resolved", inquiryId: matches[0].id };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", inquiries: matches };
    }
    if (pending.length === 0) {
      return { kind: "not_operator" };
    }
    return { kind: "unknown_ref", ref: input.ref };
  }

  const pending = await listPendingInquiriesForSender(senderDigits);
  if (pending.length === 0) {
    return { kind: "not_operator" };
  }
  if (pending.length === 1) {
    return { kind: "resolved", inquiryId: pending[0].id };
  }
  return { kind: "ambiguous", inquiries: pending };
}
