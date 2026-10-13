import type { OperatorListing } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { Category, Trip } from "@/lib/discover";

const CATEGORY_MAP: Record<string, Category> = {
  dive: "Dive",
  "sail & yacht": "Sail & Yacht",
  sail: "Sail & Yacht",
  yacht: "Sail & Yacht",
  wildlife: "Wildlife",
  expedition: "Expedition",
};

/**
 * OperatorListing.category is free text (operators can type anything via
 * operator-listing-service.ts; the Rezdy sync defaults to "Tour"). Trip.category is a strict
 * 4-value enum tied to the filter pills - anything that doesn't map cleanly falls to "Expedition"
 * as the most generic bucket, rather than adding a 5th filter option (that would change the design).
 */
function mapCategory(raw: string): Category {
  return CATEGORY_MAP[raw.trim().toLowerCase()] ?? "Expedition";
}

// Used only when a listing has no heroImageUrl yet - keeps the card from rendering a broken image
// while still looking like part of the site, not a stock-photo generic default going elsewhere.
const FALLBACK_IMAGE = "/great-barrier.jpg";

/**
 * Real, published operator listings (from Rezdy sync or any future source), shaped into the same
 * Trip type the 6 curated example trips use - so TripGrid/TripSheet render them with zero design
 * changes. Deliberately honest about what real data doesn't have yet, per the 2026-08-07 decision:
 * no fabricated rating, reviews, testimonial quote, day-by-day itinerary, or operator-specific claims
 * - those fields are simply omitted (see the optional fields on Trip) rather than invented, and
 * TripGrid/TripSheet already hide the corresponding UI blocks when they're absent.
 *
 * Listings with no real price are skipped entirely rather than shown with a fabricated or zero
 * price - Trip.price is load-bearing for the "A$X/guest" display and the 5%-of-fare math in
 * TripSheet, both un-guarded in the UI, so showing one without a real number would look broken.
 */
export async function fetchSyncedTrips(): Promise<Trip[]> {
  const listings = await prisma.operatorListing.findMany({
    where: { status: "LIVE", priceFrom: { not: null } },
    include: { operatorProfile: { select: { companyName: true } } },
    orderBy: { publishedAt: "desc" },
  });

  return listings.map(listingToTrip);
}

type ListingForTrip = OperatorListing & { operatorProfile: { companyName: string | null } };

/** One live listing in the Trip shape the grid and sheet render. Pure, so it can be tested without a database. */
export function listingToTrip(listing: ListingForTrip): Trip {
  return {
    slug: listing.slug,
    name: listing.title,
    category: mapCategory(listing.category),
    region: listing.region,
    operator: listing.operatorProfile.companyName || listing.title,
    duration: "Full day",
    detail: listing.maxGuests ? `Up to ${listing.maxGuests} guests` : "Small group",
    // Universal, true for every trip on the platform - not a claim about this specific operator.
    impact: "funds ocean and reef conservation",
    price: listing.priceFrom as number,
    currency: listing.currency,
    img: listing.heroImageUrl || FALLBACK_IMAGE,
    // No stock-photo stand-in here, unlike the 6 curated demo trips (lib/discover.ts) - a real
    // operator listing with no real gallery photos should show no gallery, not stock ones.
    gallery: [],
    summary: listing.description,
    highlights: [],
    itinerary: [],
    includes: [],
    departures: [],
    // BluePass's own standard conservation-fund allocation, applied uniformly - not an
    // operator-specific claim. Placeholder split pending Tony confirming the real breakdown; keep in
    // sync with whatever the curated 6 trips' typical split is if that changes.
    impactSplit: { protect: 40, restore: 30, uplift: 30 },
    fundsPartner: "ocean and reef conservation",
    ...(listing.bookingUrl && (listing.bookingPlatform === "FAREHARBOR" || listing.bookingPlatform === "REZDY")
      ? { booking: { platform: listing.bookingPlatform, url: listing.bookingUrl } }
      : {}),
  };
}
