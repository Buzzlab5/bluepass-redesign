import { prisma } from "@/lib/db/prisma";
import { trips as curatedTrips } from "@/lib/discover";
import { fetchSyncedTrips } from "@/lib/services/discover/operator-listings-as-trips";

/** Every trip a traveller has shortlisted, as `Trip.slug`s — the identity the Discover UI already
 * keys its client-side `saved` state on, whether the trip is curated or a real synced listing. */
export async function listSavedTripSlugs(accountId: string): Promise<string[]> {
  const rows = await prisma.savedTrip.findMany({
    where: { accountId },
    select: { tripSlug: true },
  });

  return rows.map((row) => row.tripSlug);
}

export type SavedTripSummary = {
  slug: string;
  name: string;
  operator: string;
  region: string;
  price: number;
  currency?: string;
  img: string;
};

/**
 * Shortlisted trips, resolved against the same catalog Discover renders — curated examples plus
 * whatever's really synced from Rezdy — so a saved trip that's since gone unlisted simply drops
 * out rather than showing broken. Order follows the catalog, not save date: there's no ordering a
 * traveller would notice or expect from a handful of saved trips.
 */
export async function loadSavedTripSummaries(accountId: string): Promise<SavedTripSummary[]> {
  const slugs = await listSavedTripSlugs(accountId);
  if (slugs.length === 0) return [];

  const savedSet = new Set(slugs);
  const syncedTrips = await fetchSyncedTrips().catch(() => []);
  const catalog = [...curatedTrips, ...syncedTrips];

  return catalog
    .filter((trip) => savedSet.has(trip.slug))
    .map((trip) => ({
      slug: trip.slug,
      name: trip.name,
      operator: trip.operator,
      region: trip.region,
      price: trip.price,
      currency: trip.currency,
      img: trip.img,
    }));
}

/** Flips one trip's saved state for this account and reports which way it landed, so the caller
 * doesn't have to guess from an empty response. */
export async function toggleSavedTrip(accountId: string, tripSlug: string): Promise<{ saved: boolean }> {
  const existing = await prisma.savedTrip.findUnique({
    where: { accountId_tripSlug: { accountId, tripSlug } },
    select: { id: true },
  });

  if (existing) {
    await prisma.savedTrip.delete({ where: { id: existing.id } });
    return { saved: false };
  }

  await prisma.savedTrip.create({ data: { accountId, tripSlug } });
  return { saved: true };
}
