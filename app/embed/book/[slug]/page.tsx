import { notFound } from "next/navigation";
import BookingPanel from "@/components/rails/BookingPanel";
import FareHarborPanel from "@/components/rails/FareHarborPanel";
import { bookableTrip, checkoutFor, openingMonth, tripHeadline } from "@/lib/services/channels/trips";

export const dynamic = "force-dynamic";

/** The booking card on its own, for an iframe on the operator's website. */
export default async function EmbedBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trip = await bookableTrip(slug);
  if (!trip) notFound();
  const now = new Date();

  return (
    <>
      {trip.kind === "fareharbor" ? (
        <FareHarborPanel
          slug={slug}
          title={trip.listing.title}
          operatorName={trip.operatorName}
          fromCents={tripHeadline(trip, now)}
          currency={trip.listing.currency}
          embed
        />
      ) : (
        <BookingPanel
          slug={slug}
          title={trip.listing.title}
          operatorName={trip.operatorName}
          embed
          initial={await openingMonth(trip, now)}
          fromCents={tripHeadline(trip, now)}
          {...(() => {
            const checkout = checkoutFor(trip);
            return { cutoffHours: checkout.cutoffHours, questions: checkout.questions, payment: checkout.payment };
          })()}
        />
      )}
      <p className="ds-micro bk-embed__by">Bookings by <a href="https://bluepass.co" target="_top">Bluepass</a></p>
    </>
  );
}
