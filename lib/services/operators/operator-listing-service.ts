import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { normalizeSlug } from "@/lib/services/operators/operator-leads";

export const operatorListingInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2).max(80),
  region: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(4000),
  heroImageUrl: z.string().trim().max(500).optional(),
  maxGuests: z.coerce.number().int().positive().max(500).optional(),
  priceSignal: z.string().trim().max(120).optional(),
  /* Not optional in practice, even though the column is nullable: fetchSyncedTrips() only ever
     shows a listing with `priceFrom: { not: null }` on Discover, since Trip.price backs both the
     "A$X/guest" display and the 5%-conservation-split math there, un-guarded. A self-service
     listing with no priceFrom saves fine and shows on the operator's own dashboard, but never
     reaches a traveller - discovered live (2026-08-24) the first time this schema was driven by a
     real form instead of only the Rezdy sync, which always supplies one. */
  priceFrom: z.coerce.number().positive().max(1_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
});

export type OperatorListingInput = z.infer<typeof operatorListingInputSchema>;

async function requireOwnedOperatorProfile(accountId: string) {
  const profile = await prisma.operatorProfile.findUnique({
    where: { accountId },
    select: { id: true },
  });

  if (!profile) {
    throw new Error("Operator profile was not found for this account.");
  }

  return profile;
}

async function requireOwnedListing(listingId: string, operatorProfileId: string) {
  const listing = await prisma.operatorListing.findUnique({
    where: { id: listingId },
  });

  if (!listing) {
    throw new Error("Operator listing was not found.");
  }

  if (listing.operatorProfileId !== operatorProfileId) {
    throw new Error("This listing does not belong to the acting operator account.");
  }

  return listing;
}

export async function buildUniqueListingSlug(title: string) {
  const base = normalizeSlug(title) || "listing";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.operatorListing.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) {
      return slug;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

function listingWriteData(input: OperatorListingInput) {
  const currency = input.currency?.trim().toUpperCase() || "AUD";
  const priceSignal =
    input.priceSignal?.trim() || (input.priceFrom ? `From ${currency} ${input.priceFrom}` : null);

  return {
    title: input.title.trim(),
    category: input.category.trim(),
    region: input.region.trim(),
    description: input.description.trim(),
    heroImageUrl: normalizeOptionalUrl(input.heroImageUrl),
    maxGuests: input.maxGuests ?? null,
    priceFrom: input.priceFrom ?? null,
    priceSignal,
    currency,
  };
}

// Mirrors operator-claim-service.ts's normalizeOptionalUrl: operators paste URLs in all sorts of
// loose formats (bare domain, no scheme), so this is deliberately forgiving rather than rejecting
// via zod's strict .url() - which is what previously crashed the "New listing" form on any
// heroImageUrl missing "https://".
export function normalizeOptionalUrl(value?: string | null) {
  const raw = value?.trim();

  if (!raw) {
    return null;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw.replace(/^\/+/, "")}`;
}

export async function createDraftListing(
  input: OperatorListingInput & { accountId: string },
) {
  const profile = await requireOwnedOperatorProfile(input.accountId);
  const slug = await buildUniqueListingSlug(input.title);

  return prisma.operatorListing.create({
    data: {
      operatorProfileId: profile.id,
      slug,
      status: "DRAFT",
      ...listingWriteData(input),
    },
  });
}

export async function updateDraftListing(
  input: OperatorListingInput & { listingId: string; accountId: string },
) {
  const profile = await requireOwnedOperatorProfile(input.accountId);
  const listing = await requireOwnedListing(input.listingId, profile.id);

  if (listing.status !== "DRAFT") {
    throw new Error("Only draft listings can be edited.");
  }

  return prisma.operatorListing.update({
    where: { id: listing.id },
    data: listingWriteData(input),
  });
}

// No admin review gate: publishing is entirely operator-initiated, matching how most
// self-service marketplaces work (publish first, moderate reactively via archiveListing below).
export async function publishListing(input: { listingId: string; accountId: string }) {
  const profile = await requireOwnedOperatorProfile(input.accountId);
  const listing = await requireOwnedListing(input.listingId, profile.id);

  if (listing.status !== "DRAFT") {
    throw new Error("Only draft listings can be published.");
  }

  return prisma.operatorListing.update({
    where: { id: listing.id },
    data: {
      status: "LIVE",
      publishedAt: new Date(),
    },
  });
}

// Admin-only moderation: takes an already-live listing down. Not an operator action.
export async function archiveListing(input: {
  listingId: string;
  archivedBy: string;
  reason: string;
}) {
  const listing = await prisma.operatorListing.findUnique({
    where: { id: input.listingId },
  });

  if (!listing) {
    throw new Error("Operator listing was not found.");
  }

  if (listing.status !== "LIVE") {
    throw new Error("Only live listings can be deactivated.");
  }

  return prisma.operatorListing.update({
    where: { id: listing.id },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
      archivedBy: input.archivedBy,
      archivedReason: input.reason.trim(),
    },
  });
}

// Admin-only: brings a deactivated listing back live.
export async function reactivateListing(input: { listingId: string }) {
  const listing = await prisma.operatorListing.findUnique({
    where: { id: input.listingId },
  });

  if (!listing) {
    throw new Error("Operator listing was not found.");
  }

  if (listing.status !== "ARCHIVED") {
    throw new Error("Only archived listings can be reactivated.");
  }

  return prisma.operatorListing.update({
    where: { id: listing.id },
    data: {
      status: "LIVE",
      archivedAt: null,
      archivedBy: null,
      archivedReason: null,
    },
  });
}

export async function listOperatorListingsForAccount(accountId: string) {
  const profile = await requireOwnedOperatorProfile(accountId);

  return prisma.operatorListing.findMany({
    where: { operatorProfileId: profile.id },
    orderBy: { createdAt: "desc" },
  });
}
