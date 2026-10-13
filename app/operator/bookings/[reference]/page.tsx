import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Notice from "@/components/auth/Notice";
import BookingActions from "@/components/rails/BookingActions";
import CheckInToggle from "@/components/rails/CheckInToggle";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { formatClock, formatDepartureDay } from "@/lib/services/rails/format";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { extrasText, partyText, paymentLabel, sourceLabel, statusLabel } from "@/lib/services/rails/labels";
import { tripUrl, whatsappChatLink } from "@/lib/services/rails/links";
import { formatMoney } from "@/lib/services/rails/money";
import { bookingDetail } from "@/lib/services/rails/views";

export const metadata = { title: "Booking · Bluepass" };

const EVENT_WORDS: Record<string, string> = {
  reserved: "Seats held while paying",
  paid: "Paid online",
  created: "Booking entered",
  cancelled: "Cancelled",
  refunded: "Refunded",
  expired: "Payment not completed; seats released",
  checked_in: "Checked in",
  check_in_undone: "Check-in undone",
  collected: "Marked as paid to you",
  confirmation_sent: "Confirmation resent",
  settled: "Paid out to you",
  refund_needed: "Refund needs attention",
  whatsapp_on: "Guest turned on WhatsApp updates",
  whatsapp_off: "Guest turned off WhatsApp updates",
  paid_via_rezdy: "Paid by card through Rezdy",
  rezdy_refused: "Rezdy refused the booking",
  rezdy_unconfirmed: "Rezdy did not answer in time",
  rezdy_hold_skipped: "Seats not held in Rezdy",
  rezdy_confirm_failed: "Rezdy did not confirm the hold",
  rezdy_rebook_failed: "Rezdy could not book again",
  rezdy_release_failed: "Rezdy did not release the hold",
  rezdy_record_failed: "Booked in Rezdy, not yet recorded here",
  moved: "Moved in Rezdy",
  accepted: "Accepted in Rezdy",
};

/** History times in the operator's zone, like everything else they read. */
function stamper(timeZone: string) {
  const f = new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (d: Date) => f.format(d);
}

const MESSAGE_KINDS: Record<string, string> = {
  booking_confirmed: "Confirmation",
  trip_reminder: "Day-before reminder",
  booking_cancelled: "Cancellation notice",
  booking_requested: "Request received",
  booking_moved: "New time",
  departure_update: "Your update",
  operator_new_booking: "Alert to you",
};

const MESSAGE_STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  QUEUED: { label: "Sending", tone: "muted" },
  SENT: { label: "Sent", tone: "good" },
  DELIVERED: { label: "Delivered", tone: "good" },
  READ: { label: "Read", tone: "good" },
  FAILED: { label: "Not delivered", tone: "bad" },
  SKIPPED: { label: "Not sent", tone: "muted" },
};

/** Events whose message says something the event's name does not. */
const EVENT_DETAIL = new Set(["cancelled", "expired", "refund_needed", "moved", "rezdy_refused", "rezdy_unconfirmed", "rezdy_record_failed"]);

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { reference } = await params;
  const { created } = await searchParams;
  const { profile, rails } = await requireRailsOperator(`/operator/bookings/${reference}`);
  if (!rails.enabled) return <RailsUnavailable title="Booking" reason={rails.reason} />;

  const b = await bookingDetail({ operatorProfileId: profile.id, reference });
  if (!b) notFound();

  const tz = b.timezone;
  const stamp = stamper(tz);
  const status = statusLabel(b.status);
  const pay = paymentLabel(b);
  const active = b.status === "CONFIRMED" || b.status === "REQUESTED" || b.status === "PENDING_PAYMENT";
  const paidOnline = b.paymentStatus === "PAID";
  const refundText = paidOnline
    ? `${formatMoney(b.totalCents - b.refundedCents, b.currency)} goes back to the guest's card in full.`
    : b.paymentStatus === "PAID_VIA_CHANNEL"
      ? `It is cancelled in Rezdy too, and Rezdy refunds the ${formatMoney(b.totalCents - b.refundedCents, b.currency)} to the guest's card.`
      : "No money moves; Bluepass did not take payment for this booking.";

  const facts: [string, React.ReactNode][] = [
    ...(b.externalReference ? [["Rezdy order", b.externalReference] as [string, React.ReactNode]] : []),
    ["Party", partyText(b.lines, b.guests)],
    ...(extrasText(b.lines) ? [["Add-ons", extrasText(b.lines)] as [string, React.ReactNode]] : []),
    ["Phone", b.leadPhone ? (
      <span key="phone" className="rl-guest__phone">
        <a href={`tel:${b.leadPhone.replace(/\s/g, "")}`}>{b.leadPhone}</a>
        {whatsappChatLink(b.leadPhone) ? (
          <a href={whatsappChatLink(b.leadPhone, `Hi ${b.leadName.split(" ")[0]}, it's ${profile.companyName ?? "the crew"} about your booking ${b.reference}.`)!} target="_blank" rel="noreferrer" className="ds-micro rl-wa">WhatsApp</a>
        ) : null}
      </span>
    ) : "Not given"],
    ["Email", b.leadEmail ? <a href={`mailto:${b.leadEmail}`}>{b.leadEmail}</a> : "Not given"],
    ["Fare", b.totalCents > 0 ? formatMoney(b.totalCents, b.currency) : "Not priced"],
    ["Payment", <StatusPill key="pay" tone={pay.tone}>{pay.label}</StatusPill>],
  ];
  if (b.source !== "OPERATOR" && b.operatorNetCents > 0) {
    facts.push([
      "Yours",
      b.paymentStatus === "PAID_VIA_CHANNEL"
        ? `${formatMoney(b.operatorNetCents, b.currency)}, paid to you by Rezdy`
        : `${formatMoney(b.operatorNetCents, b.currency)}${b.settledAt ? ", paid out" : ", paid out after the trip runs"}`,
    ]);
  }
  const answers = b.answers as { pickup?: string | null } | null;
  if (answers?.pickup) facts.push(["Pickup", answers.pickup]);
  if (b.conservationCents > 0) facts.push(["To the reef", formatMoney(b.conservationCents, b.currency)]);
  facts.push(["Booked", `${stamp(b.createdAt)} · ${sourceLabel(b.source)}`]);
  if (b.notes) facts.push(["Notes", b.notes]);
  if (b.cancelReason) facts.push(["Cancelled because", b.cancelReason]);
  if (b.guestToken) facts.push(["Guest's page", <a key="trip" href={tripUrl(b.guestToken)} target="_blank" rel="noreferrer">Open ↗</a>]);
  facts.push(["WhatsApp updates", b.whatsappOptIn ? "Yes, the guest opted in" : "No"]);

  return (
    <>
      <p className="ds-caption rl-crumb">
        <Link href="/operator/bookings">Bookings</Link> <span aria-hidden>›</span> {b.reference}
      </p>
      <AdminPageHeader
        context={b.reference}
        title={b.leadName}
        support={`${b.listing.title} · ${formatDepartureDay(b.departsAt, tz)}, ${formatClock(b.departsAt, tz)}`}
        aside={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      />

      {created ? (
        <div className="rl-gap">
          <Notice tone="success">Booking saved. Those seats are off the booking page now.</Notice>
        </div>
      ) : null}

      <section className="adm-block">
        <div className="adm-card">
          {b.status === "CONFIRMED" ? (
            <div className="rl-checkin-row">
              <CheckInToggle bookingId={b.id} reference={b.reference} checkedIn={Boolean(b.checkedInAt)} name={b.leadName} />
              <span className="ds-body-sm">{b.checkedInAt ? `Checked in at ${formatClock(b.checkedInAt, tz)}` : "Not checked in yet"}</span>
              <Link href={`/operator/departures/${b.listing.id}/${b.departsAt.getTime()}`} className="ds-caption rl-checkin-row__link">Open manifest ›</Link>
            </div>
          ) : null}
          <dl className="adm-facts">
            {facts.map(([label, value]) => (
              <div key={label} className="adm-facts__row">
                <dt className="ds-micro adm-facts__label">{label}</dt>
                <dd className="ds-body-sm adm-facts__value">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {active ? (
        <section className="adm-block">
          <BookingActions
            bookingId={b.id}
            reference={b.reference}
            canCollect={b.source === "OPERATOR" && b.paymentStatus === "UNPAID"}
            canResend={b.status === "CONFIRMED" && Boolean(b.leadEmail || b.whatsappOptIn)}
            canCancel={!b.settledAt}
            refundText={refundText}
            hasEmail={Boolean(b.leadEmail)}
          />
        </section>
      ) : null}

      {b.notifications.length > 0 ? (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">Messages</h2>
          </header>
          <ul className="rl-rows">
            {b.notifications.map((n) => {
              const status = MESSAGE_STATUS[n.status] ?? MESSAGE_STATUS.QUEUED;
              return (
                <li key={n.id} className="rl-rows__item">
                  <div className="rl-rows__main">
                    <span className="ds-body-sm rl-rows__title">
                      {MESSAGE_KINDS[n.kind] ?? n.kind} · {n.channel === "WHATSAPP" ? "WhatsApp" : "Email"}
                    </span>
                    <span className="ds-caption rl-rows__meta">
                      {stamp(n.createdAt)} · {n.recipient || "No number"}
                      {n.detail && (n.status === "FAILED" || n.status === "SKIPPED") ? ` · ${n.detail}` : ""}
                    </span>
                  </div>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">History</h2>
        </header>
        <ol className="adm-log">
          {b.events.map((e) => (
            <li key={e.id} className="adm-log__row">
              <span className="ds-micro adm-log__when">{stamp(e.createdAt)}</span>
              <span className="ds-body-sm adm-log__body">
                {EVENT_WORDS[e.type] ?? e.type}
                {e.message && EVENT_DETAIL.has(e.type) ? ` · ${e.message}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
