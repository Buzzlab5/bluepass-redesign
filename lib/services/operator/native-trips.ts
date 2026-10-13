import type { OperatorListing } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  createKaiNativeTrip,
  deleteKaiNativeTrip,
  ensureKaiNativeTenant,
  getKaiNativeTrip,
  KaiNativeError,
  listKaiNativeTrips,
  setKaiNativeTripPublished,
  updateKaiNativeTrip,
  type NativeTrip,
} from "@/lib/services/kai-core/native-admin";
import { editorToKaiInput, type TripEditorValues } from "@/lib/services/operator/native-trip-editor";
import type { OperatorProfileView } from "@/lib/services/operator/guard";
import { buildUniqueListingSlug } from "@/lib/services/operators/operator-listing-service";

/**
 * The operator's trips, kept in step across Kai (which sells and takes the seats) and this app's
 * listing table (which is what bluepass.co shows). Kai is the source of truth for the trip; the
 * listing is a mirror written from it, so the website can never show a trip Kai cannot sell.
 *
 * Every function takes the operator's own profile, read from their session, never an id from the
 * browser.
 */

type Profile = Pick<OperatorProfileView, "id" | "status" | "companyName" | "whatsappE164" | "kaiTenantSlug" | "rezdySupplierId">;

export type TripResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; message: string };

export type Deps = {
  ensureTenant: typeof ensureKaiNativeTenant;
  createTrip: typeof createKaiNativeTrip;
  updateTrip: typeof updateKaiNativeTrip;
  getTrip: typeof getKaiNativeTrip;
  listTrips: typeof listKaiNativeTrips;
  setPublished: typeof setKaiNativeTripPublished;
  deleteTrip: typeof deleteKaiNativeTrip;
};

const REAL_DEPS: Deps = {
  ensureTenant: ensureKaiNativeTenant,
  createTrip: createKaiNativeTrip,
  updateTrip: updateKaiNativeTrip,
  getTrip: getKaiNativeTrip,
  listTrips: listKaiNativeTrips,
  setPublished: setKaiNativeTripPublished,
  deleteTrip: deleteKaiNativeTrip,
};

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof KaiNativeError) {
    if (error.code === "NOT_NATIVE") {
      return { ok: false, message: "Your bookings already run through another booking system, so trips are managed there." };
    }
    return { ok: false, message: error.issues[0] ?? error.message };
  }
  console.error("native trip request failed", error);
  return { ok: false, message: "Something went wrong. Nothing was changed. Try again." };
}

/** Operators synced from Rezdy get their trips from Rezdy; the trips screen is not for them. */
export function operatorCanUseNativeTrips(profile: Pick<OperatorProfileView, "rezdySupplierId">) {
  return !profile.rezdySupplierId;
}

/**
 * The operator's Kai tenant, created on first use. Kai creates it idempotently on the operator's
 * profile id, and the slug is stored on the profile so every later call is one lookup.
 * `goLive` makes the operator visible to travellers' chat; it is only asked for at publish time.
 */
export async function ensureOperatorTenant(profile: Profile, options: { goLive?: boolean } = {}, deps: Deps = REAL_DEPS) {
  if (profile.kaiTenantSlug && !options.goLive) return profile.kaiTenantSlug;

  const tenant = await deps.ensureTenant({
    externalOperatorId: profile.id,
    name: profile.companyName?.trim() || "Operator",
    adminWhatsAppPhone: profile.whatsappE164,
    goLive: options.goLive,
  });

  if (profile.kaiTenantSlug !== tenant.slug) {
    /* Only fills an empty slot: a profile already linked to a different tenant keeps that link. */
    await prisma.operatorProfile.updateMany({ where: { id: profile.id, kaiTenantSlug: null }, data: { kaiTenantSlug: tenant.slug } });
  }

  return profile.kaiTenantSlug ?? tenant.slug;
}

export type ListingFields = {
  title: string;
  category: string;
  region: string;
  description: string;
  heroImageUrl: string | null;
  maxGuests: number | null;
  priceFrom: number | null;
  priceSignal: string | null;
  currency: string;
};

/** What the website listing says about a trip. Pure, so the mapping is testable without a database. */
export function listingFieldsForTrip(trip: NativeTrip, extras: { category: string; region: string }): ListingFields {
  const activeSeats = trip.schedules.filter((schedule) => schedule.active).map((schedule) => schedule.seats);
  const lowest = trip.lowestTicketCents;
  const priceFrom = lowest === null ? null : lowest / 100;

  return {
    title: trip.title,
    category: extras.category,
    region: extras.region,
    description: trip.description || trip.title,
    heroImageUrl: trip.photoUrls[0] ?? null,
    maxGuests: activeSeats.length > 0 ? Math.max(...activeSeats) : null,
    priceFrom,
    priceSignal: priceFrom === null ? null : `From ${trip.currency} ${priceFrom % 1 === 0 ? priceFrom : priceFrom.toFixed(2)}`,
    currency: trip.currency,
  };
}

export type ListingSyncResult = { listing: OperatorListing; takenDown: boolean };

/**
 * Writes or updates the website listing for a trip. A listing an admin took down (ARCHIVED) stays
 * down: the operator can edit the trip, but only an admin can bring the listing back.
 */
export async function syncListingForTrip(input: {
  operatorProfileId: string;
  trip: NativeTrip;
  category: string;
  region: string;
}): Promise<ListingSyncResult> {
  const { trip } = input;
  const fields = listingFieldsForTrip(trip, input);
  const published = trip.status === "PUBLISHED";
  const existing = await prisma.operatorListing.findUnique({ where: { nativeTripId: trip.id } });

  if (!existing) {
    const listing = await prisma.operatorListing.create({
      data: {
        operatorProfileId: input.operatorProfileId,
        nativeTripId: trip.id,
        slug: await buildUniqueListingSlug(trip.title),
        bookingPlatform: "NATIVE",
        status: published ? "LIVE" : "DRAFT",
        publishedAt: published ? new Date() : null,
        ...fields,
      },
    });
    return { listing, takenDown: false };
  }

  if (existing.status === "ARCHIVED") {
    const listing = await prisma.operatorListing.update({ where: { id: existing.id }, data: fields });
    return { listing, takenDown: published };
  }

  const listing = await prisma.operatorListing.update({
    where: { id: existing.id },
    data: {
      ...fields,
      status: published ? "LIVE" : "DRAFT",
      publishedAt: published ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
    },
  });
  return { listing, takenDown: false };
}

async function listingExtras(tripId: string) {
  const listing = await prisma.operatorListing.findUnique({ where: { nativeTripId: tripId }, select: { category: true, region: true, status: true } });
  return listing;
}

export type TripSummary = {
  trip: NativeTrip;
  listingStatus: "LIVE" | "DRAFT" | "ARCHIVED" | null;
};

export async function loadOperatorTrips(profile: Profile, deps: Deps = REAL_DEPS): Promise<TripResult<{ trips: TripSummary[] }>> {
  if (!profile.kaiTenantSlug) return { ok: true, trips: [] };

  try {
    const [trips, listings] = await Promise.all([
      deps.listTrips(profile.kaiTenantSlug),
      prisma.operatorListing.findMany({ where: { operatorProfileId: profile.id, nativeTripId: { not: null } }, select: { nativeTripId: true, status: true } }),
    ]);
    const statusByTrip = new Map(listings.map((listing) => [listing.nativeTripId, listing.status]));
    return { ok: true, trips: trips.map((trip) => ({ trip, listingStatus: statusByTrip.get(trip.id) ?? null })) };
  } catch (error) {
    return failure(error);
  }
}

export async function loadOperatorTrip(profile: Profile, tripId: string, deps: Deps = REAL_DEPS) {
  if (!profile.kaiTenantSlug) return { ok: false as const, message: "That trip was not found." };

  try {
    const [trip, extras] = await Promise.all([deps.getTrip(profile.kaiTenantSlug, tripId), listingExtras(tripId)]);
    return { ok: true as const, trip, listing: extras };
  } catch (error) {
    return failure(error);
  }
}

/** Saves a trip (creating it the first time), then refreshes its listing. Never publishes. */
export async function saveOperatorTrip(
  profile: Profile,
  tripId: string | null,
  values: TripEditorValues,
  deps: Deps = REAL_DEPS,
): Promise<TripResult<{ trip: NativeTrip; listingTakenDown: boolean }>> {
  if (!operatorCanUseNativeTrips(profile)) return { ok: false, message: "Your trips are managed by your Rezdy connection." };

  const converted = editorToKaiInput(values);
  if (!converted.ok) return converted;

  try {
    const tenantSlug = await ensureOperatorTenant(profile, {}, deps);
    const trip = tripId
      ? await deps.updateTrip(tenantSlug, tripId, converted.input)
      : await deps.createTrip(tenantSlug, converted.input);
    const synced = await syncListingForTrip({ operatorProfileId: profile.id, trip, category: converted.category, region: converted.region });
    return { ok: true, trip, listingTakenDown: synced.takenDown };
  } catch (error) {
    return failure(error);
  }
}

/** Puts a saved trip on sale: Kai checks it is sellable, then the operator goes live and the listing appears. */
export async function publishOperatorTrip(profile: Profile, tripId: string, deps: Deps = REAL_DEPS): Promise<TripResult<{ trip: NativeTrip; listingTakenDown: boolean }>> {
  if (profile.status !== "APPROVED" && profile.status !== "LIVE") {
    return { ok: false, message: "Your account is still being reviewed. You can save trips now and publish them once Bluepass approves you." };
  }

  const extras = await listingExtras(tripId);
  if (!extras) return { ok: false, message: "Save the trip first, then publish it." };

  try {
    const tenantSlug = await ensureOperatorTenant(profile, {}, deps);
    const trip = await deps.setPublished(tenantSlug, tripId, true);
    await ensureOperatorTenant({ ...profile, kaiTenantSlug: tenantSlug }, { goLive: true }, deps);
    const synced = await syncListingForTrip({ operatorProfileId: profile.id, trip, category: extras.category, region: extras.region });
    return { ok: true, trip, listingTakenDown: synced.takenDown };
  } catch (error) {
    return failure(error);
  }
}

export async function unpublishOperatorTrip(profile: Profile, tripId: string, deps: Deps = REAL_DEPS): Promise<TripResult<{ trip: NativeTrip }>> {
  if (!profile.kaiTenantSlug) return { ok: false, message: "That trip was not found." };
  const extras = await listingExtras(tripId);

  try {
    const trip = await deps.setPublished(profile.kaiTenantSlug, tripId, false);
    if (extras) await syncListingForTrip({ operatorProfileId: profile.id, trip, category: extras.category, region: extras.region });
    return { ok: true, trip };
  } catch (error) {
    return failure(error);
  }
}

/** Deletes a trip nobody has booked, with its listing. A booked trip must be unpublished instead. */
export async function deleteOperatorTrip(profile: Profile, tripId: string, deps: Deps = REAL_DEPS): Promise<TripResult> {
  if (!profile.kaiTenantSlug) return { ok: false, message: "That trip was not found." };

  try {
    await deps.deleteTrip(profile.kaiTenantSlug, tripId);
    await prisma.operatorListing.deleteMany({ where: { nativeTripId: tripId, operatorProfileId: profile.id } });
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
