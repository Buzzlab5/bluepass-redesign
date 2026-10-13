import { formatClock, formatDepartureDay } from "@/lib/services/rails/format";
import { googleCalendarLink, tripCalendarFileUrl, tripUrl, siteUrl } from "@/lib/services/rails/links";
import { formatMoney } from "@/lib/services/rails/money";

/**
 * What each booking email says. Content only: sending, and recording that it was
 * sent, belong to notify.ts, which treats email and WhatsApp as two routes for the
 * same message.
 *
 * Plain and short, and each answers the question its reader actually has: "am I
 * booked and where do I go", "who is coming on my boat", "what happened to my money".
 */

export type EmailContent = { subject: string; html: string; text: string };

export type EmailBooking = {
  reference: string;
  departsAt: Date;
  timezone: string;
  guests: number;
  lines: { rateId?: string; label: string; amountCents: number; quantity: number; perGuest?: boolean }[];
  totalCents: number;
  currency: string;
  conservationCents: number;
  leadName: string;
  leadEmail: string | null;
  leadPhone: string | null;
  notes: string | null;
  source: string;
  guestToken: string | null;
  paymentStatus?: string;
  /** The booking's number in the operator's own system (a Rezdy order), which their crew checks guests in by. */
  externalReference?: string | null;
};

export type EmailListing = {
  slug: string;
  title: string;
  meetingPoint: string | null;
  confirmationNote: string | null;
  durationMinutes: number | null;
  operatorName: string;
  operatorWhatsapp: string | null;
};

function esc(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function when(b: EmailBooking) {
  return `${formatDepartureDay(b.departsAt, b.timezone)}, ${formatClock(b.departsAt, b.timezone)}`;
}

type Button = { label: string; href: string };

function layout(title: string, rows: [string, string][], paragraphs: string[], buttons: Button[] = []) {
  const table = rows
    .map(([k, v]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#6e6e6e;font-size:13px;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
      `<td style="padding:6px 0;color:#0f0f0f;font-size:14px">${esc(v).replace(/\n/g, "<br>")}</td></tr>`)
    .join("");
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;color:#0f0f0f;font-size:14px;line-height:1.5">${esc(p)}</p>`).join("");
  const actions = buttons
    .map((b, i) =>
      `<a href="${esc(b.href)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:999px;` +
      `font-size:14px;text-decoration:none;${i === 0 ? "background:#0f0f0f;color:#ffffff" : "background:#efefec;color:#0f0f0f"}">${esc(b.label)}</a>`)
    .join("");
  // 60-30-10, as the booking pages: off-white page, white card, greys, one near-black accent.
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font-family:-apple-system,Inter,Segoe UI,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ececea;border-radius:14px;padding:28px">
<p style="margin:0 0 6px;color:#0f0f0f;font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase">Bluepass</p>
<h1 style="margin:0 0 20px;color:#0f0f0f;font-size:22px;line-height:1.2">${esc(title)}</h1>
<table style="border-collapse:collapse;margin:0 0 20px">${table}</table>
${actions ? `<div style="margin:0 0 18px">${actions}</div>` : ""}
${body}
</div></body></html>`;
}

function text(title: string, rows: [string, string][], paragraphs: string[], buttons: Button[] = []) {
  return [title, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", ...buttons.map((b) => `${b.label}: ${b.href}`), "", ...paragraphs]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function content(subject: string, title: string, rows: [string, string][], paragraphs: string[], buttons: Button[] = []): EmailContent {
  return { subject, html: layout(title, rows, paragraphs, buttons), text: text(title, rows, paragraphs, buttons) };
}

function partyLine(b: EmailBooking) {
  // Taxes and fees a booking system adds are part of the price, not of the party.
  return b.lines
    .filter((l) => l.rateId !== "fees" && !l.rateId?.startsWith("extra:"))
    .map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.label}` : l.label))
    .join(", ");
}

/** "View your booking" and "Add to Google Calendar", for any booking with a guest page. */
function travellerButtons(b: EmailBooking, listing: EmailListing): Button[] {
  if (!b.guestToken) return [];
  const endsAt = new Date(b.departsAt.getTime() + (listing.durationMinutes ?? 120) * 60_000);
  return [
    { label: "View your booking", href: tripUrl(b.guestToken) },
    {
      label: "Add to Google Calendar",
      href: googleCalendarLink({
        title: listing.title,
        startsAt: b.departsAt,
        endsAt,
        details: `Booking ${b.reference} with ${listing.operatorName}. ${tripUrl(b.guestToken)}`,
        location: listing.meetingPoint,
        timezone: b.timezone,
      }),
    },
    { label: "Apple or Outlook", href: tripCalendarFileUrl(b.guestToken) },
  ];
}

function bookingRows(b: EmailBooking, listing: EmailListing): [string, string][] {
  const rows: [string, string][] = [["Booking", b.reference]];
  if (b.externalReference) rows.push(["Operator reference", b.externalReference]);
  rows.push(["Trip", listing.title], ["When", when(b)], ["Guests", `${b.guests} · ${partyLine(b)}`]);
  const addOns = b.lines.filter((l) => l.rateId?.startsWith("extra:"));
  if (addOns.length) rows.push(["Add-ons", addOns.map((l) => (l.quantity > 1 ? `${l.label} × ${l.quantity}` : l.label)).join(", ")]);
  if (b.totalCents > 0 && b.source !== "OPERATOR") rows.push(["Paid", formatMoney(b.totalCents, b.currency)]);
  if (listing.meetingPoint) rows.push(["Meet at", listing.meetingPoint]);
  rows.push(["Operator", listing.operatorWhatsapp ? `${listing.operatorName} · ${listing.operatorWhatsapp}` : listing.operatorName]);
  return rows;
}

/** Who holds the money, said plainly: Bluepass until the trip runs, or the operator's own booking system. */
function paymentNote(b: EmailBooking, listing: EmailListing): string[] {
  if (b.source === "OPERATOR") return [];
  if (b.paymentStatus === "PAID_VIA_CHANNEL") return [`Your card was charged by ${listing.operatorName}'s own booking system, which pays them directly.`];
  return ["Your money is held by Bluepass and only paid to the operator once the trip has run."];
}

export function confirmationEmail(b: EmailBooking, listing: EmailListing): EmailContent {
  const rows = bookingRows(b, listing);

  const paragraphs: string[] = [];
  if (listing.confirmationNote) paragraphs.push(listing.confirmationNote);
  if (b.conservationCents > 0) {
    paragraphs.push(`${formatMoney(b.conservationCents, b.currency)} of your fare, a fixed 5%, goes to protecting the reef you are about to visit.`);
  }
  paragraphs.push(...paymentNote(b, listing));
  paragraphs.push(`Quote ${b.externalReference ?? b.reference} if you need to reach the operator about this booking.`);

  return content(
    `You're booked: ${listing.title}, ${formatDepartureDay(b.departsAt, b.timezone)}`,
    `You're booked, ${b.leadName.split(" ")[0]}.`,
    rows,
    paragraphs,
    travellerButtons(b, listing),
  );
}

/** Paid, and waiting for the operator to accept it in their own booking system. */
export function requestedEmail(b: EmailBooking, listing: EmailListing): EmailContent {
  return content(
    `Requested: ${listing.title}, ${formatDepartureDay(b.departsAt, b.timezone)}`,
    `Your booking is with ${listing.operatorName}, ${b.leadName.split(" ")[0]}.`,
    bookingRows(b, listing),
    [
      `${listing.operatorName} accepts each booking for this trip themselves. You will hear from Bluepass the moment they do.`,
      "If they cannot take you on this departure, your payment comes back to your card in full.",
      `Quote ${b.externalReference ?? b.reference} if you need to reach the operator about this booking.`,
    ],
    travellerButtons(b, listing).slice(0, 1),
  );
}

export function reminderEmail(b: EmailBooking, listing: EmailListing): EmailContent {
  const rows: [string, string][] = [
    ["Booking", b.reference],
    ["When", when(b)],
    ["Guests", `${b.guests} · ${partyLine(b)}`],
  ];
  if (listing.meetingPoint) rows.push(["Meet at", listing.meetingPoint]);
  return content(
    `Tomorrow: ${listing.title}`,
    `See you tomorrow, ${b.leadName.split(" ")[0]}.`,
    rows,
    [listing.confirmationNote ?? "Arrive a little early so the crew can check you in."],
    travellerButtons(b, listing).slice(0, 1),
  );
}

export function operatorAlertEmail(b: EmailBooking, listing: EmailListing, manifestUrl: string): EmailContent {
  const rows: [string, string][] = [
    ["Booking", b.reference],
    ["Departure", when(b)],
    ["Guests", `${b.guests} · ${partyLine(b)}`],
    ["Lead guest", [b.leadName, b.leadPhone, b.leadEmail].filter(Boolean).join(" · ")],
  ];
  if (b.notes) rows.push(["Notes", b.notes]);
  if (b.totalCents > 0) rows.push(["Fare", formatMoney(b.totalCents, b.currency)]);

  return content(
    `New booking: ${listing.title}, ${formatDepartureDay(b.departsAt, b.timezone)}`,
    `${b.guests} ${b.guests === 1 ? "guest" : "guests"} booked on ${listing.title}`,
    rows,
    [],
    [{ label: "Open the manifest", href: manifestUrl }],
  );
}

export function cancellationEmail(b: EmailBooking, listing: EmailListing, detail: { reason: string; refundedCents: number }): EmailContent {
  const rows: [string, string][] = [
    ["Booking", b.reference],
    ["Trip", listing.title],
    ["Was", when(b)],
    ["Reason", detail.reason],
  ];
  if (detail.refundedCents > 0) rows.push(["Refund", formatMoney(detail.refundedCents, b.currency)]);

  const paragraphs = detail.refundedCents > 0
    ? ["The refund is on its way to the card you paid with. Banks usually show it within 5 to 10 business days."]
    : [];
  return content(
    `Cancelled: ${listing.title}, ${formatDepartureDay(b.departsAt, b.timezone)}`,
    "Your booking has been cancelled",
    rows,
    paragraphs,
    [{ label: "Pick another date", href: `${siteUrl()}/book/${listing.slug}` }],
  );
}

export function departureUpdateEmail(b: EmailBooking, listing: EmailListing, message: string): EmailContent {
  return content(
    `Update about ${listing.title}, ${formatDepartureDay(b.departsAt, b.timezone)}`,
    `An update from ${listing.operatorName}`,
    [["Trip", listing.title], ["When", when(b)], ["Booking", b.reference]],
    [message],
    travellerButtons(b, listing).slice(0, 1),
  );
}
