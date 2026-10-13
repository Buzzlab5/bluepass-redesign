import type { ReactNode } from "react";
import type { PricedLine } from "@/lib/services/operators/listing-availability";
import { formatClock, formatDepartureDay, formatDuration } from "@/lib/services/rails/format";
import { extrasText, partyText } from "@/lib/services/rails/labels";
import { googleCalendarLink, tripUrl, whatsappChatLink } from "@/lib/services/rails/links";
import { formatMoney } from "@/lib/services/rails/money";

export type TicketBooking = {
  reference: string;
  status: string;
  source: string;
  paymentStatus: string;
  leadName: string;
  leadEmail: string | null;
  departsAt: Date;
  timezone: string;
  guests: number;
  lines: unknown;
  totalCents: number;
  refundedCents: number;
  currency: string;
  conservationCents: number;
  cancelReason: string | null;
  guestToken: string | null;
  externalReference?: string | null;
};

export type TicketListing = {
  slug: string;
  title: string;
  meetingPoint: string | null;
  confirmationNote: string | null;
  durationMinutes: number | null;
  operatorName: string;
  operatorWhatsapp: string | null;
};

/**
 * A booking as its guest sees it, on the page they land on after paying and on
 * their own booking page later. Everything they need on the day, and one tap each to
 * put it in their calendar or message the crew.
 */
export default function BookingTicket({
  booking: b,
  listing,
  calendarFileUrl,
  headline,
  extra,
}: {
  booking: TicketBooking;
  listing: TicketListing;
  calendarFileUrl: string;
  headline: ReactNode;
  extra?: ReactNode;
}) {
  const tz = b.timezone;
  const minutes = listing.durationMinutes;
  const endsAt = new Date(b.departsAt.getTime() + (minutes ?? 120) * 60_000);
  const backAt = minutes ? endsAt : null;
  const paidOnline = b.paymentStatus === "PAID" || b.paymentStatus === "PARTIALLY_REFUNDED" || b.paymentStatus === "PAID_VIA_CHANNEL";
  const heldByBluepass = b.paymentStatus === "PAID" || b.paymentStatus === "PARTIALLY_REFUNDED";
  const chat = whatsappChatLink(listing.operatorWhatsapp, `Hi, this is ${b.leadName} about booking ${b.reference}.`);
  const google = googleCalendarLink({
    title: listing.title,
    startsAt: b.departsAt,
    endsAt,
    details: [`Booking ${b.reference} with ${listing.operatorName}.`, listing.confirmationNote, b.guestToken ? tripUrl(b.guestToken) : null]
      .filter(Boolean)
      .join("\n\n"),
    location: listing.meetingPoint,
    timezone: tz,
  });

  return (
    <div className="bk-done__card">
      <span className="bk-done__tick" aria-hidden>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </span>
      <p className="ds-micro bk-done__ref">{b.reference}{b.externalReference ? ` · ${listing.operatorName} ref ${b.externalReference}` : ""}</p>
      {headline}

      <dl className="bk-done__facts">
        <div><dt className="ds-micro">Trip</dt><dd className="ds-body">{listing.title}</dd></div>
        <div>
          <dt className="ds-micro">When</dt>
          <dd className="ds-body">
            {formatDepartureDay(b.departsAt, tz)}, {formatClock(b.departsAt, tz)}
            {backAt ? <span className="bk-muted"> · back about {formatClock(backAt, tz)} ({formatDuration(minutes)})</span> : null}
          </dd>
        </div>
        <div><dt className="ds-micro">Guests</dt><dd className="ds-body">{partyText(b.lines as PricedLine[], b.guests)}</dd></div>
        {extrasText(b.lines as PricedLine[]) ? (
          <div><dt className="ds-micro">Add-ons</dt><dd className="ds-body">{extrasText(b.lines as PricedLine[])}</dd></div>
        ) : null}
        {listing.meetingPoint ? <div><dt className="ds-micro">Meet at</dt><dd className="ds-body">{listing.meetingPoint}</dd></div> : null}
        {paidOnline ? (
          <div><dt className="ds-micro">Paid</dt><dd className="ds-body">{formatMoney(b.totalCents, b.currency)}</dd></div>
        ) : b.totalCents > 0 && b.paymentStatus === "UNPAID" ? (
          <div><dt className="ds-micro">To pay</dt><dd className="ds-body">{formatMoney(b.totalCents, b.currency)} to {listing.operatorName} on the day</dd></div>
        ) : null}
        <div><dt className="ds-micro">With</dt><dd className="ds-body">{listing.operatorName}</dd></div>
      </dl>

      {listing.confirmationNote ? <p className="ds-body-sm bk-done__note">{listing.confirmationNote}</p> : null}
      {b.conservationCents > 0 ? (
        <p className="ds-body-sm bk-done__reef">{formatMoney(b.conservationCents, b.currency)} of your fare, a fixed 5%, goes to protecting the reef.</p>
      ) : null}

      <div className="bk-done__actions">
        <a href={google} target="_blank" rel="noreferrer" className="bk-cta">Add to Google Calendar</a>
        <a href={calendarFileUrl} className="bk-cta bk-cta--quiet">Apple or Outlook</a>
        {chat ? (
          <a href={chat} target="_blank" rel="noreferrer" className="bk-cta bk-cta--quiet">WhatsApp {listing.operatorName}</a>
        ) : null}
      </div>

      {extra}

      {heldByBluepass ? (
        <p className="ds-micro bk-muted">Your payment is held by Bluepass and only paid to the operator once the trip has run.</p>
      ) : b.paymentStatus === "PAID_VIA_CHANNEL" ? (
        <p className="ds-micro bk-muted">Paid through {listing.operatorName}&rsquo;s own booking system, which pays them directly.</p>
      ) : null}
    </div>
  );
}
