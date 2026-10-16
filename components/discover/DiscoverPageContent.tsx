import Script from "next/script";
import DiscoverState from "@/components/discover/DiscoverState";
import DiscoverHero from "@/components/discover/DiscoverHero";
import TrustBanner from "@/components/discover/TrustBanner";
import RegionRail from "@/components/discover/RegionRail";
import TripGrid from "@/components/discover/TripGrid";
import TripSheet from "@/components/discover/TripSheet";
import HowItWorks from "@/components/discover/HowItWorks";
import PartnerMarquee from "@/components/discover/PartnerMarquee";
import SiteFooter from "@/components/SiteFooter";
import { trips as curatedTrips } from "@/lib/discover";
import { fetchSyncedTrips } from "@/lib/services/discover/operator-listings-as-trips";

/**
 * The trips page itself, with nothing around it.
 *
 * It lives here, not inside `app/page.tsx`, so that the public page and the private preview page
 * render exactly the same thing: the only difference between them is who is let in. Unlocking the
 * site is then a single switch (`WAITLIST_POPUP_ENABLED` off) and the page the public gets is the one
 * that was already checked at the preview address, not a near copy of it.
 *
 * `operatorTripsFirst` is the one deliberate difference: the preview puts the real operator listings
 * (the ones being tested) ahead of the curated six, so a reviewer sees at once which trips are new.
 * The public page leaves it off and keeps the curated showcase first.
 */
export default async function DiscoverPageContent({ operatorTripsFirst = false }: { operatorTripsFirst?: boolean }) {
  // Real, published operator listings (e.g. from the Rezdy Agent sync) are appended after the
  // curated 6 rather than replacing them - the page never looks sparse while real inventory is
  // still trickling in, and the curated trips keep showcasing the design at its best. Fails open:
  // if the DB read fails for any reason, the curated 6 alone still render.
  const syncedTrips = await fetchSyncedTrips().catch((error) => {
    console.error("discover_page.fetch_synced_trips_failed", error);
    return [];
  });
  const trips = operatorTripsFirst ? [...syncedTrips, ...curatedTrips] : [...curatedTrips, ...syncedTrips];
  const hasFareHarborTrip = trips.some((trip) => trip.booking?.platform === "FAREHARBOR");

  return (
    <main style={{ background: "var(--color-canvas)", position: "relative" }}>
      {/* Region, category, shortlist and the open trip are one piece of state —
          the hero select, the rail and the grid are three views onto it. */}
      <DiscoverState trips={trips}>
        <DiscoverHero />
        <TrustBanner />
        <RegionRail />
        <TripGrid />
        <TripSheet />
      </DiscoverState>
      <HowItWorks />
      <PartnerMarquee />
      <SiteFooter />
      {/* FareHarbor's Lightframe: turns their booking links into an overlay on this page, so a
          traveller books without leaving Bluepass. Their affiliate guide asks for exactly this tag.
          Only loaded when a FareHarbor trip is listed. */}
      {hasFareHarborTrip ? (
        <Script src="https://fareharbor.com/embeds/api/v1/?autolightframe=yes" strategy="lazyOnload" />
      ) : null}
    </main>
  );
}
