import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import BookingPanel from "@/components/rails/BookingPanel";
import FareHarborPanel from "@/components/rails/FareHarborPanel";
import { bookableTrip, checkoutFor, openingMonth, tripHeadline } from "@/lib/services/channels/trips";
import { FALLBACK_TRIP_IMAGE } from "@/lib/discover";
import { cssImage, describeWeekdays, formatDuration, formatLocalTime } from "@/lib/services/rails/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const trip = await bookableTrip(slug);
  if (!trip) return { title: "Bluepass" };
  return {
    title: `Book ${trip.listing.title} · Bluepass`,
    description: trip.listing.description.slice(0, 160),
    openGraph: { title: `Book ${trip.listing.title}`, images: trip.listing.heroImageUrl ? [trip.listing.heroImageUrl] : undefined },
  };
}

/**
 * The page an operator's booking link opens. One trip, one decision: the story on
 * the left, the booking on the right, nothing else competing for the click.
 *
 * The same page sells a trip whatever holds its seats: Bluepass's own calendar, the
 * operator's Rezdy read live, or their FareHarbor checkout opened over the page.
 */
export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trip = await bookableTrip(slug);
  if (!trip) notFound();
  const { listing } = trip;

  const now = new Date();
  const fromCents = tripHeadline(trip, now);
  const runs = trip.kind === "native"
    ? trip.native.listing.schedules
        .filter((s) => !(s.seasonStart && s.seasonEnd && s.seasonStart.getTime() === s.seasonEnd.getTime()))
        .map((s) => `${describeWeekdays(s.weekdays)} at ${s.departureTimes.map(formatLocalTime).join(" and ")}`)
    : [];
  const duration = formatDuration(listing.durationMinutes);

  let panel: React.ReactNode;
  if (trip.kind === "fareharbor") {
    panel = <FareHarborPanel slug={slug} operatorName={trip.operatorName} fromCents={fromCents} currency={listing.currency} />;
  } else {
    const checkout = checkoutFor(trip);
    panel = (
      <BookingPanel
        slug={slug}
        operatorName={trip.operatorName}
        initial={await openingMonth(trip, now)}
        fromCents={fromCents}
        cutoffHours={checkout.cutoffHours}
        questions={checkout.questions}
        payment={checkout.payment}
      />
    );
  }

  return (
    <>
      <main className="bk theme-light">
        <header className="bk-hero" style={{ backgroundImage: cssImage(listing.heroImageUrl || FALLBACK_TRIP_IMAGE) }}>
          <div className="bk-hero__shade" />
          <div className="bk-hero__copy">
            <p className="ds-micro bk-hero__eyebrow">{listing.region} · {trip.operatorName}</p>
            <h1 className="ds-display-lg bk-hero__title">{listing.title}</h1>
          </div>
        </header>

        <div className="bk-grid">
          <article className="bk-about">
            <dl className="bk-facts">
              {runs.length ? (
                <div><dt className="ds-micro">Runs</dt><dd className="ds-body-sm">{runs.join("; ")}</dd></div>
              ) : null}
              {duration ? <div><dt className="ds-micro">Length</dt><dd className="ds-body-sm">{duration}</dd></div> : null}
              {listing.meetingPoint ? <div><dt className="ds-micro">Meet at</dt><dd className="ds-body-sm">{listing.meetingPoint}</dd></div> : null}
            </dl>
            {listing.description.split(/\n{2,}/).map((p, i) => (
              <p key={i} className="ds-body-lg bk-about__p">{p}</p>
            ))}
            {listing.confirmationNote ? (
              <>
                <h2 className="ds-micro bk-about__label">Good to know</h2>
                <p className="ds-body bk-about__note">{listing.confirmationNote}</p>
              </>
            ) : null}
            <p className="ds-body-sm bk-about__reef">
              Booked at the operator&rsquo;s own price. A fixed 5% of every fare goes to protecting the reefs these trips depend on.
            </p>
          </article>

          <aside className="bk-aside">{panel}</aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
