import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import NewBookingForm from "@/components/rails/NewBookingForm";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { prisma } from "@/lib/db/prisma";
import { listDepartures, localDateInZone, ratesForDate } from "@/lib/services/operators/listing-availability";
import { requireRailsOperator } from "@/lib/services/rails/guard";
import { operatorToday } from "@/lib/services/rails/views";

export const metadata = { title: "New booking · Bluepass" };

/**
 * Two steps on one page: which trip and which day (a plain GET form, so it works on
 * a phone with no JavaScript to speak of), then the booking itself.
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
        <AdminPageHeader eyebrow="Bookings" title="New booking" />
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
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : preselect ? localDateInZone(new Date(preselect), timezone) : today;

  const [day] = await listDepartures({ listingId: listing.id, from: date, to: date, ignoreWindow: true });
  const departures = (day?.departures ?? []).map((d) => ({
    at: d.departsAt.getTime(),
    localTime: d.localTime,
    seatsLeft: d.seatsLeft,
    capacity: d.capacity,
    closed: d.closed,
  }));
  const rates = ratesForDate(listing.rates, date).map((r) => ({ id: r.id, label: r.label, amountCents: r.amountCents, perGuest: r.perGuest }));

  return (
    <>
      <p className="ds-caption rl-crumb">
        <Link href="/operator/bookings">Bookings</Link> <span aria-hidden>›</span> New
      </p>
      <AdminPageHeader eyebrow="Phone, walk-up or desk" title="New booking" support="Seats you sell yourself come off the booking page straight away, so nothing is ever sold twice." />

      <form className="rl-pick adm-card" method="get">
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Trip</span>
          <select name="listing" defaultValue={listing.id} className="rl-input">
            {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
          </select>
        </label>
        <label className="rl-field">
          <span className="ds-micro rl-field__label">Date</span>
          <input type="date" name="date" defaultValue={date} className="rl-input" />
        </label>
        <button type="submit" className="rl-btn rl-btn--secondary">Show departures</button>
      </form>

      {day?.blackout ? (
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
            />
          </div>
        </section>
      )}
    </>
  );
}
