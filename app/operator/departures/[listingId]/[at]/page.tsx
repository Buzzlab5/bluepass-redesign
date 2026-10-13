import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Notice from "@/components/auth/Notice";
import CheckInToggle from "@/components/rails/CheckInToggle";
import DepartureControls from "@/components/rails/DepartureControls";
import DepartureMessage from "@/components/rails/DepartureMessage";
import PrintButton from "@/components/rails/PrintButton";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { formatClock, formatDepartureDay, formatDuration } from "@/lib/services/rails/format";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { channelLabel, extrasText, paymentLabel, partyText, statusLabel } from "@/lib/services/rails/labels";
import { whatsappChatLink, whatsappDigits } from "@/lib/services/rails/links";
import { formatMoney } from "@/lib/services/rails/money";
import { whatsappSwitchedOn } from "@/lib/services/rails/notify";
import { departureManifest } from "@/lib/services/rails/views";

export const metadata = { title: "Manifest · Bluepass" };

/** A guest's pickup and their answers to the operator's own booking questions, one line each. */
function answerLines(raw: unknown): string[] {
  const a = raw as { fields?: Record<string, string>; participants?: Record<string, string>[]; pickup?: string | null } | null;
  if (!a) return [];
  const lines: string[] = [];
  if (a.pickup) lines.push(`Pickup: ${a.pickup}`);
  for (const [label, value] of Object.entries(a.fields ?? {})) if (value) lines.push(`${label}: ${value}`);
  (a.participants ?? []).forEach((p, i) => {
    const text = Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ");
    if (text) lines.push(`Guest ${i + 1}: ${text}`);
  });
  return lines;
}

/**
 * One departure: who is coming, who has arrived, who still owes money, and the
 * controls for the departure itself. Prints as a clean manifest for the skipper.
 */
export default async function DeparturePage({ params }: { params: Promise<{ listingId: string; at: string }> }) {
  const { listingId, at: atParam } = await params;
  const at = Number(atParam);
  if (!Number.isFinite(at)) notFound();

  const { profile, rails } = await requireRailsOperator(`/operator/departures/${listingId}/${atParam}`);
  if (!rails.enabled) return <RailsUnavailable title="Manifest" reason={rails.reason} />;

  const m = await departureManifest({ operatorProfileId: profile.id, listingId, departsAt: new Date(at) });
  if (!m) notFound();

  const departsAt = new Date(at);
  const tz = m.timezone;
  const backAt = m.listing.durationMinutes ? new Date(at + m.listing.durationMinutes * 60_000) : null;
  const capacity = m.departure?.capacity ?? 0;
  const external = m.listing.channel !== "NATIVE";
  const from = channelLabel(m.listing.channel);
  const paidOnline = m.onboard.filter((b) => b.paymentStatus === "PAID" || b.paymentStatus === "PAID_VIA_CHANNEL").length;
  const whatsappOn = whatsappSwitchedOn();
  const reach = { whatsapp: 0, email: 0, unreachable: [] as string[] };
  for (const b of m.onboard) {
    if (whatsappOn && b.whatsappOptIn && whatsappDigits(b.leadPhone)) reach.whatsapp += 1;
    else if (b.leadEmail) reach.email += 1;
    else reach.unreachable.push(b.leadName);
  }

  const support = [
    m.listing.meetingPoint,
    backAt ? `Back about ${formatClock(backAt, tz)} (${formatDuration(m.listing.durationMinutes)})` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <p className="ds-caption rl-crumb rl-noprint">
        <Link href={`/operator/calendar?week=${m.date}`}>Calendar</Link> <span aria-hidden>›</span> {formatDepartureDay(departsAt, tz)}
      </p>
      <AdminPageHeader
        context={`${formatDepartureDay(departsAt, tz)} · ${formatClock(departsAt, tz)}`}
        title={m.listing.title}
        support={support || undefined}
        aside={
          <div className="rl-actions rl-noprint">
            <PrintButton />
            {external ? null : <Link href={`/operator/bookings/new?listing=${listingId}&at=${at}`} className="rl-btn rl-btn--primary">Add booking</Link>}
          </div>
        }
      />

      {external ? (
        <p className="ds-caption rl-muted rl-gap rl-noprint">
          The guests Bluepass booked on this {from} departure. Your full manifest, with bookings from every channel, is in {from}.
        </p>
      ) : null}

      {m.departure?.busy ? (
        <div className="rl-gap">
          {m.totals.guests > 0 ? (
            <Notice tone="error">
              Your Google Calendar shows you busy during this trip, but {m.totals.guests} {m.totals.guests === 1 ? "guest is" : "guests are"} booked on it. If the boat is out on charter, cancel this departure below so they are told and refunded.
            </Notice>
          ) : (
            <Notice tone="info">Your Google Calendar shows you busy during this trip, so it is closed to online bookings. You can still add bookings yourself.</Notice>
          )}
        </div>
      ) : null}

      {!m.departure ? (
        <div className="adm-card adm-fault">
          <p className="ds-body-sm">This departure is no longer on the schedule{m.blackout ? `: closed for ${m.blackout}` : ""}. The bookings below still stand until you cancel them.</p>
        </div>
      ) : null}

      <dl className="rl-stats">
        <div className="rl-stat">
          <dt className="ds-micro">Guests</dt>
          <dd className="ds-display-md">{m.totals.guests}{external ? null : <span className="rl-stat__of"> / {capacity}</span>}</dd>
        </div>
        <div className="rl-stat">
          <dt className="ds-micro">Checked in</dt>
          <dd className="ds-display-md">{m.totals.checkedIn}<span className="rl-stat__of"> / {m.totals.guests}</span></dd>
        </div>
        {m.totals.toCollectCents > 0 ? (
          <div className="rl-stat">
            <dt className="ds-micro">To collect</dt>
            <dd className="ds-display-md">{formatMoney(m.totals.toCollectCents, m.listing.currency)}</dd>
          </div>
        ) : null}
        {m.departure?.closed ? (
          <div className="rl-stat">
            <dt className="ds-micro">Sales</dt>
            <dd><StatusPill tone="bad">Closed</StatusPill></dd>
          </div>
        ) : m.departure && m.departure.minGuests > m.totals.guests && m.totals.guests > 0 ? (
          <div className="rl-stat">
            <dt className="ds-micro">To run</dt>
            <dd><StatusPill tone="warn">Needs {m.departure.minGuests - m.totals.guests} more</StatusPill></dd>
          </div>
        ) : null}
      </dl>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">On board</h2>
        </header>
        {m.onboard.length === 0 ? (
          <div className="adm-card adm-empty">
            <p className="ds-body-sm adm-empty__title">Nobody booked yet.</p>
            <p className="ds-body-sm adm-empty__body">
              {external ? `Bookings Bluepass makes in ${from} appear here the moment they are paid.` : "Bookings from your link, Bluepass and Kai appear here the moment they are paid."}
            </p>
          </div>
        ) : (
          <ul className="rl-manifest">
            {m.onboard.map((b) => {
              const pay = paymentLabel(b);
              return (
                <li key={b.id} className={`rl-guest${b.checkedInAt ? " is-in" : ""}`}>
                  <CheckInToggle bookingId={b.id} reference={b.reference} checkedIn={Boolean(b.checkedInAt)} name={b.leadName} />
                  <div className="rl-guest__who">
                    <span className="ds-body rl-guest__name">{b.leadName}</span>
                    <span className="ds-caption rl-guest__party">{partyText(b.lines, b.guests)}</span>
                    {b.notes ? <span className="ds-caption rl-guest__notes">“{b.notes}”</span> : null}
                    {extrasText(b.lines) ? <span className="ds-caption rl-guest__party">Add-ons: {extrasText(b.lines)}</span> : null}
                    {answerLines(b.answers).map((line) => <span key={line} className="ds-caption rl-guest__party">{line}</span>)}
                  </div>
                  <div className="rl-guest__contact">
                    {b.leadPhone ? (
                      <span className="rl-guest__phone">
                        <a href={`tel:${b.leadPhone.replace(/\s/g, "")}`} className="ds-caption">{b.leadPhone}</a>
                        {whatsappChatLink(b.leadPhone) ? (
                          <a href={whatsappChatLink(b.leadPhone, `Hi ${b.leadName.split(" ")[0]}, it's ${profile.companyName ?? "the crew"} about your ${m.listing.title} booking ${b.reference}.`)!} target="_blank" rel="noreferrer" className="ds-micro rl-wa rl-noprint">WhatsApp</a>
                        ) : null}
                      </span>
                    ) : null}
                    <Link href={`/operator/bookings/${b.reference}`} className="ds-micro rl-guest__ref">{b.externalReference ? `${b.externalReference} · ${b.reference}` : b.reference}</Link>
                  </div>
                  <span className="rl-guest__pay">
                    {b.status === "REQUESTED" ? <StatusPill tone={statusLabel(b.status).tone}>{statusLabel(b.status).label}</StatusPill> : <StatusPill tone={pay.tone}>{pay.label}</StatusPill>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {m.pending.length > 0 ? (
        <section className="adm-block rl-noprint">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">Paying now</h2>
            <p className="ds-caption adm-block__note">Seats held while these guests pay. They are let go automatically if payment does not finish.</p>
          </header>
          <ul className="rl-rows">
            {m.pending.map((b) => (
              <li key={b.id} className="rl-rows__item">
                <div className="rl-rows__main">
                  <span className="ds-body rl-rows__title">{b.leadName}</span>
                  <span className="ds-caption rl-rows__meta">{partyText(b.lines, b.guests)} · held until {b.expiresAt ? formatClock(b.expiresAt, tz) : "soon"}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {m.onboard.length > 0 ? (
        <section className="adm-block rl-noprint">
          <DepartureMessage listingId={listingId} at={at} reach={reach} />
        </section>
      ) : null}

      {m.departure ? (
        <section className="adm-block rl-noprint">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">This departure</h2>
          </header>
          <DepartureControls
            listingId={listingId}
            at={at}
            capacity={m.departure.capacity}
            ruleCapacity={m.departure.ruleCapacity}
            closed={m.departure.closed}
            note={m.departure.note}
            onboard={m.totals.guests}
            paidOnline={paidOnline}
            channel={m.listing.channel}
          />
        </section>
      ) : null}

      {m.cancelled.length > 0 ? (
        <section className="adm-block rl-noprint">
          <details className="rl-details">
            <summary className="ds-body-sm">{m.cancelled.length} cancelled</summary>
            <ul className="rl-rows">
              {m.cancelled.map((b) => (
                <li key={b.id} className="rl-rows__item">
                  <div className="rl-rows__main">
                    <Link href={`/operator/bookings/${b.reference}`} className="ds-body rl-rows__title">{b.leadName}</Link>
                    <span className="ds-caption rl-rows__meta">{partyText(b.lines, b.guests)}{b.cancelReason ? ` · ${b.cancelReason}` : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
    </>
  );
}
