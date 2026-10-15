import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import NewBookingForm from "@/components/rails/NewBookingForm";
import NewBookingPicker, { type PickerDate } from "@/components/rails/NewBookingPicker";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { prisma } from "@/lib/db/prisma";
import { addDays, listDepartures, localDateInZone, ratesForDate } from "@/lib/services/operators/listing-availability";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { operatorToday } from "@/lib/services/rails/views";

export const metadata = { title: "New booking · Bluepass" };

/** How far ahead a phone booking can be taken: far enough for a season, short enough to list. */
const BOOKABLE_DAYS = 180;

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Two steps on one page: which trip and which day (from the trip's own schedule, so no
 * date is ever typed), then the booking itself.
 */
export default async function NewBookingPage({ searchParams }: { searchParams: Promise<{ listing?: string; date?: string; at?: string }> }) {
  const { profile, rails } = await requireRailsOperator("/operator/bookings/new");
  if (!rails.enabled) return <RailsUnavailable title="New booking" reason={rails.reason} />;

  const params = await searchParams;
  const listings = await prisma.operatorListing.findMany({
    where: { operatorProfileId: profile.id, status: "LIVE", channel: "NATIVE", schedules: { some: { active: true } } },
    select: { id: true, title: true, currency: true, schedules: { where: { active: true }, select: { timezone: true }, take: 1 }, rates: { where: { active: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (listings.length === 0) {
    const external = await prisma.operatorListing.findFirst({
      where: { operatorProfileId: profile.id, channel: { not: "NATIVE" } },
      select: { channel: true },
    });
    const from = external?.channel === "REZDY" ? "Rezdy" : "FareHarbor";
    return (
      <>
        <AdminPageHeader title="New booking" />
        <div className="adm-card adm-empty">
          {external ? (
            <>
              <p className="ds-body-sm adm-empty__title">Take phone bookings in {from}.</p>
              <p className="ds-body-sm adm-empty__body">Your trips&rsquo; seats live in {from}, so a booking made there comes off every channel at once, Bluepass included.</p>
            </>
          ) : (
            <>
              <p className="ds-body-sm adm-empty__title">No live trips with a schedule yet.</p>
              <p className="ds-body-sm adm-empty__body">Set when a trip runs on the <Link href="/operator/trips">Trips</Link> page and publish it, then bookings can be taken against it.</p>
            </>
          )}
        </div>
      </>
    );
  }

  const listing = listings.find((l) => l.id === params.listing) ?? listings[0];
  const timezone = listing.schedules[0]?.timezone ?? "Australia/Brisbane";
  const preselect = params.at && Number.isFinite(Number(params.at)) ? Number(params.at) : null;
  const { today } = await operatorToday(profile.id);
  const requested = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : preselect ? localDateInZone(new Date(preselect), timezone) : null;

  /* The days to offer come from the trip's own schedule: only a day that runs and still has a seat. */
  const horizon = requested && requested > addDays(today, BOOKABLE_DAYS) ? requested : addDays(today, BOOKABLE_DAYS);
  const upcoming = await listDepartures({ listingId: listing.id, from: today, to: horizon, ignoreWindow: true });
  const dates: PickerDate[] = upcoming
    .filter((d) => d.departures.some((x) => x.seatsLeft > 0))
    .map((d) => {
      const times = d.departures.filter((x) => x.seatsLeft > 0).length;
      return { value: d.date, label: dayLabel(d.date), note: times > 1 ? `${times} departures` : "" };
    });
  const date = requested && dates.some((d) => d.value === requested) ? requested : (dates[0]?.value ?? requested ?? today);

  const [day] = await listDepartures({ listingId: listing.id, from: date, to: date, ignoreWindow: true });
  const departures = (day?.departures ?? []).map((d) => ({
    at: d.departsAt.getTime(),
    localTime: d.localTime,
    seatsLeft: d.seatsLeft,
    capacity: d.capacity,
    closed: d.closed,
    minGuests: d.minGuests,
  }));
  const rates = ratesForDate(listing.rates, date).map((r) => ({ id: r.id, label: r.label, amountCents: r.amountCents, perGuest: r.perGuest }));

  return (
    <>
      <p className="ds-caption rl-crumb">
        <Link href="/operator/bookings">Bookings</Link> <span aria-hidden>›</span> New
      </p>
      <AdminPageHeader title="New booking" support="Seats you sell yourself come off the booking page straight away, so nothing is ever sold twice." />

      <NewBookingPicker listings={listings.map((l) => ({ id: l.id, title: l.title }))} listingId={listing.id} dates={dates} date={dates.length ? date : ""} />

      {dates.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">No days with a seat left in the next {BOOKABLE_DAYS} days.</p>
          <p className="ds-body-sm adm-empty__body">Check the season and days on the <Link href={`/operator/trips/${listing.id}`}>trip setup</Link> page, or the closed dates.</p>
        </div>
      ) : null}

      {dates.length === 0 ? null : day?.blackout ? (
        <div className="adm-card adm-empty"><p className="ds-body-sm adm-empty__title">Closed that day: {day.blackout}.</p></div>
      ) : (
        <section className="adm-block">
          <div className="adm-card">
            <NewBookingForm
              key={`${listing.id}-${date}`}
              listingId={listing.id}
              departures={departures}
              rates={rates}
              currency={listing.currency}
              preselect={preselect && departures.some((d) => d.at === preselect) ? preselect : null}
              phoneCountry={profile.country}
            />
          </div>
        </section>
      )}
    </>
  );
}
