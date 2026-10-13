import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Notice from "@/components/auth/Notice";
import BusyCalendarPicker from "@/components/rails/BusyCalendarPicker";
import { ChannelVisibility, FareHarborLinkForm, FareHarborUnlink } from "@/components/rails/ChannelTripControls";
import ClosedDates from "@/components/rails/ClosedDates";
import CopyField from "@/components/rails/CopyField";
import LogisticsForm from "@/components/rails/LogisticsForm";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import RateEditor from "@/components/rails/RateEditor";
import ScheduleEditor from "@/components/rails/ScheduleEditor";
import { prisma } from "@/lib/db/prisma";
import { fareHarborLinkOf } from "@/lib/services/channels/fareharbor/connect";
import { fareHarborAffiliate } from "@/lib/services/channels/fareharbor/links";
import { paymentMode, questionsFor } from "@/lib/services/channels/rezdy/map";
import { rezdyData } from "@/lib/services/channels/rezdy/sync";
import { formatDuration } from "@/lib/services/rails/format";
import { formatMoney } from "@/lib/services/rails/money";
import { googleCalendarApi } from "@/lib/services/rails/google/api";
import { operatorCalendars } from "@/lib/services/rails/google/sync";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { loadTripSetup } from "@/lib/services/rails/setup";

export const metadata = { title: "Trip setup · Bluepass" };

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://bluepass.co").replace(/\/$/, "");
}

/**
 * One trip's booking setup, top to bottom in the order an operator thinks about it:
 * when it runs, what it costs, when it does not run, what guests need to know, and
 * finally the link that sells it. Everything saves on its own; there is no page-wide
 * save button to forget.
 */
export default async function TripSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, rails } = await requireRailsOperator(`/operator/trips/${id}`);
  if (!rails.enabled) return <RailsUnavailable title="Trip setup" reason={rails.reason} />;

  const setup = await loadTripSetup(id, profile.id);
  if (!setup) notFound();
  const { listing, schedules, rates, blackouts, readiness } = setup;
  if (listing.channel !== "NATIVE") return <ChannelTripSetup setup={setup} />;
  const fareHarbor = fareHarborAffiliate()
    ? await prisma.operatorChannelConnection.findUnique({
        where: { operatorProfileId_platform: { operatorProfileId: profile.id, platform: "FAREHARBOR" } },
        select: { status: true },
      })
    : null;

  // The operator's own calendars, read live so the picker always shows what is in their account.
  const connection = await prisma.operatorGoogleConnection.findUnique({ where: { operatorProfileId: profile.id }, select: { status: true } });
  const google = googleCalendarApi();
  let calendars: { id: string; summary: string; primary: boolean }[] | null = null;
  let calendarState: "connected" | "not_connected" | "unreadable" = "not_connected";
  if (connection?.status === "CONNECTED" && google) {
    calendars = await operatorCalendars(profile.id, google).catch(() => null);
    calendarState = calendars ? "connected" : "unreadable";
  } else if (connection) {
    calendarState = "unreadable";
  }

  const bookUrl = `${siteUrl()}/book/${listing.slug}`;
  const embedSrc = `${siteUrl()}/embed/book/${listing.slug}`;
  const embed =
    `<iframe id="bluepass-book" src="${embedSrc}" title="Book ${listing.title.replace(/"/g, "&quot;")}" ` +
    `style="width:100%;max-width:460px;height:720px;border:0;border-radius:20px" loading="lazy"></iframe>\n` +
    `<script>addEventListener("message",function(e){if(e.origin==="${siteUrl()}"&&e.data&&e.data.bluepassHeight){document.getElementById("bluepass-book").style.height=e.data.bluepassHeight+"px"}})</script>`;

  const steps = [
    { done: readiness.hasSchedule, label: "When it runs" },
    { done: readiness.hasPrice, label: "A price" },
    { done: readiness.live, label: "Published" },
  ];

  return (
    <>
      <p className="ds-caption rl-crumb">
        <Link href="/operator/trips">Trips</Link> <span aria-hidden>›</span> {listing.title}
      </p>
      <AdminPageHeader
        eyebrow="Trip setup"
        title={listing.title}
        support={
          readiness.bookable
            ? "Taking bookings. Changes here apply to the next booking; nobody already booked is affected."
            : "Three things and this trip sells itself, day and night."
        }
        aside={
          readiness.bookable ? (
            <a href={bookUrl} target="_blank" rel="noreferrer" className="rl-btn rl-btn--secondary">
              View booking page ↗
            </a>
          ) : (
            <StatusPill tone="warn">Not bookable yet</StatusPill>
          )
        }
      />

      {!readiness.bookable ? (
        <ol className="rl-checklist">
          {steps.map((s, i) => (
            <li key={s.label} className={`rl-checklist__step${s.done ? " is-done" : ""}`}>
              <span className="rl-checklist__mark" aria-hidden>{s.done ? "✓" : i + 1}</span>
              <span className="ds-body-sm">{s.label}</span>
            </li>
          ))}
          {!readiness.live ? (
            <li className="rl-checklist__note ds-caption">
              Publish the listing from your <Link href="/operator">dashboard</Link> when its description is ready.
            </li>
          ) : null}
        </ol>
      ) : null}

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">When it runs</h2>
          <p className="ds-caption adm-block__note">A pattern, not a calendar. Departures appear on their own for as far ahead as you take bookings.</p>
        </header>
        <ScheduleEditor
          listingId={listing.id}
          defaultTimezone={schedules[0]?.timezone ?? "Australia/Brisbane"}
          defaultCapacity={listing.maxGuests}
          schedules={schedules.map((s) => ({
            id: s.id,
            label: s.label,
            weekdays: s.weekdays,
            departureTimes: s.departureTimes,
            capacityPerDeparture: s.capacityPerDeparture,
            minGuests: s.minGuests,
            cutoffHours: s.cutoffHours,
            maxAdvanceDays: s.maxAdvanceDays,
            timezone: s.timezone,
            seasonStart: ymd(s.seasonStart),
            seasonEnd: ymd(s.seasonEnd),
          }))}
        />
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Prices</h2>
          <p className="ds-caption adm-block__note">What guests pay is what you set here. Bluepass adds nothing on top.</p>
        </header>
        <RateEditor
          listingId={listing.id}
          currency={listing.currency}
          rates={rates.map((r) => ({
            id: r.id,
            label: r.label,
            amountCents: r.amountCents,
            currency: r.currency,
            perGuest: r.perGuest,
            minAge: r.minAge,
            maxAge: r.maxAge,
            seasonStart: ymd(r.seasonStart),
            seasonEnd: ymd(r.seasonEnd),
            isDefault: r.isDefault,
          }))}
        />
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Closed dates</h2>
          <p className="ds-caption adm-block__note">Days the boat is not going out. For a single departure, close it from the calendar instead.</p>
        </header>
        <div className="rl-stack">
          <ClosedDates
            listingId={listing.id}
            blackouts={blackouts.map((b) => ({ id: b.id, startDate: ymd(b.startDate)!, endDate: ymd(b.endDate)!, reason: b.reason }))}
          />
          <BusyCalendarPicker listingId={listing.id} current={listing.busyCalendarId} calendars={calendars} state={calendarState} />
        </div>
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">On the day</h2>
          <p className="ds-caption adm-block__note">Sent in every confirmation and printed on the manifest.</p>
        </header>
        <LogisticsForm
          listingId={listing.id}
          durationMinutes={listing.durationMinutes}
          meetingPoint={listing.meetingPoint}
          confirmationNote={listing.confirmationNote}
        />
      </section>

      {fareHarbor?.status === "CONNECTED" ? (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">Already on FareHarbor?</h2>
            <p className="ds-caption adm-block__note">Book this trip through your FareHarbor checkout instead of Bluepass&rsquo;s calendar, so its seats live in one place.</p>
          </header>
          <FareHarborLinkForm listingId={listing.id} current={null} lede="Paste the book button link FareHarbor made for this trip with Bluepass as the affiliate." />
        </section>
      ) : null}

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Sell it anywhere</h2>
          <p className="ds-caption adm-block__note">
            {readiness.bookable
              ? "Put the link in your Instagram bio and your WhatsApp replies. Paste the widget into your own website. Every booking lands in one calendar."
              : "Your link and website widget appear here once the trip is bookable."}
          </p>
        </header>
        {readiness.bookable ? (
          <div className="adm-card rl-stack">
            <CopyField label="Booking link" value={bookUrl} />
            <CopyField label="Widget for your website" value={embed} multiline />
          </div>
        ) : null}
      </section>
    </>
  );
}

type Setup = NonNullable<Awaited<ReturnType<typeof loadTripSetup>>>;

/**
 * A trip whose seats live in the operator's own Rezdy or FareHarbor. Nothing to set up
 * here: dates, prices and questions are edited where they live. What is here is
 * whether Bluepass sells it, why it might not be able to, and the link that sells it.
 */
async function ChannelTripSetup({ setup }: { setup: Setup }) {
  const { listing, readiness } = setup;
  const from = listing.channel === "REZDY" ? "Rezdy" : "FareHarbor";
  const bookUrl = `${siteUrl()}/book/${listing.slug}`;
  const embedSrc = `${siteUrl()}/embed/book/${listing.slug}`;
  const embed =
    `<iframe id="bluepass-book" src="${embedSrc}" title="Book ${listing.title.replace(/"/g, "&quot;")}" ` +
    `style="width:100%;max-width:460px;height:720px;border:0;border-radius:20px" loading="lazy"></iframe>\n` +
    `<script>addEventListener("message",function(e){if(e.origin==="${siteUrl()}"&&e.data&&e.data.bluepassHeight){document.getElementById("bluepass-book").style.height=e.data.bluepassHeight+"px"}})</script>`;

  const rezdy = listing.channel === "REZDY" ? rezdyData(listing) : null;
  const product = rezdy?.product ?? null;
  const questions = product ? questionsFor(product, rezdy?.pickups ?? []) : null;
  const mode = product ? paymentMode(product) : null;
  const link = listing.channel === "FAREHARBOR" ? fareHarborLinkOf(listing) : null;
  const facts: [string, string][] = [];
  if (product) {
    facts.push(["Rezdy product", product.productCode]);
    facts.push([
      "Payment",
      mode === "automated"
        ? "Rezdy charges the card when the booking is made and pays you directly."
        : mode === "agent"
          ? "Bluepass takes the payment and pays you after the trip has run."
          : "Not a payment type Bluepass can sell yet.",
    ]);
    facts.push(["Confirms", product.confirmMode === "MANUAL" ? "You accept each booking in Rezdy." : "Instantly."]);
    const prices = (product.priceOptions ?? []).map((o) => `${o.label} ${formatMoney(Math.round(o.price * 100), product.currency || listing.currency)}`);
    if (prices.length) facts.push(["Prices", `${prices.join(" · ")}. Rezdy can price a departure differently; travellers see each departure's own.`]);
    const asked = [
      ...(questions?.booking ?? []).map((q) => q.label),
      ...(questions?.participant ?? []).map((q) => `${q.label} (each guest)`),
      ...(questions?.pickups.length ? ["Pickup"] : []),
    ];
    if (asked.length) facts.push(["Also asked at booking", asked.join(", ")]);
    if (product.minimumNoticeMinutes) facts.push(["Online booking closes", `${formatDuration(product.minimumNoticeMinutes)} before departure`]);
  }
  if (link) facts.push(["FareHarbor", `${link.shortname}, trip ${link.itemId}. Dates, prices and payment are FareHarbor's.`]);

  return (
    <>
      <p className="ds-caption rl-crumb">
        <Link href="/operator/trips">Trips</Link> <span aria-hidden>›</span> {listing.title}
      </p>
      <AdminPageHeader
        eyebrow={`From ${from}`}
        title={listing.title}
        support={
          listing.channel === "REZDY"
            ? "Its seats, prices and booking questions come live from Rezdy. Change them there; this page follows within 15 minutes."
            : "It books on your FareHarbor checkout, tagged as Bluepass's. FareHarbor takes the payment and you handle changes there."
        }
        aside={
          readiness.bookable ? (
            <a href={bookUrl} target="_blank" rel="noreferrer" className="rl-btn rl-btn--secondary">View booking page ↗</a>
          ) : (
            <StatusPill tone="warn">Not selling</StatusPill>
          )
        }
      />

      {listing.channelIssue ? (
        <div className="rl-gap">
          <Notice tone="error">{listing.channelIssue}</Notice>
        </div>
      ) : null}

      <section className="adm-block">
        <ChannelVisibility listingId={listing.id} live={readiness.live} from={from} />
      </section>

      {facts.length ? (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">How it sells</h2>
          </header>
          <dl className="adm-card rl-facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt className="ds-micro">{k}</dt><dd className="ds-body-sm">{v}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      {listing.channel === "FAREHARBOR" ? (
        <>
          <section className="adm-block">
            <header className="adm-block__head">
              <h2 className="ds-headline adm-block__title">FareHarbor link</h2>
            </header>
            <div className="rl-stack">
              <FareHarborLinkForm listingId={listing.id} current={listing.externalBookingUrl} lede="Replace it if FareHarbor gives you a new one." />
              <FareHarborUnlink listingId={listing.id} />
            </div>
          </section>
          <section className="adm-block">
            <header className="adm-block__head">
              <h2 className="ds-headline adm-block__title">On the day</h2>
              <p className="ds-caption adm-block__note">Shown on the booking page. FareHarbor sends the confirmation, so tell guests anything else there.</p>
            </header>
            <LogisticsForm listingId={listing.id} durationMinutes={listing.durationMinutes} meetingPoint={listing.meetingPoint} confirmationNote={listing.confirmationNote} />
          </section>
        </>
      ) : (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">On the day</h2>
            <p className="ds-caption adm-block__note">From Rezdy: the product&rsquo;s location and the information Rezdy sends after booking. Bluepass puts them in every confirmation.</p>
          </header>
          <dl className="adm-card rl-facts">
            <div><dt className="ds-micro">Length</dt><dd className="ds-body-sm">{formatDuration(listing.durationMinutes) ?? "Not set in Rezdy"}</dd></div>
            <div><dt className="ds-micro">Meet at</dt><dd className="ds-body-sm">{listing.meetingPoint ?? "Not set in Rezdy"}</dd></div>
            <div><dt className="ds-micro">Sent with every booking</dt><dd className="ds-body-sm">{listing.confirmationNote ?? "Nothing yet. Rezdy calls it Additional information."}</dd></div>
          </dl>
        </section>
      )}

      {readiness.bookable ? (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">Sell it anywhere</h2>
            <p className="ds-caption adm-block__note">Put the link in your Instagram bio and your WhatsApp replies, or the widget on your own website.</p>
          </header>
          <div className="adm-card rl-stack">
            <CopyField label="Booking link" value={bookUrl} />
            <CopyField label="Widget for your website" value={embed} multiline />
          </div>
        </section>
      ) : null}
    </>
  );
}
