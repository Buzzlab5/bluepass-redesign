import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { normalizeSlug } from "@/lib/services/operators/operator-leads";

/**
 * A number typed into a form field. Operators write "75", "75 aud", "A$75" or "1,200", so currency
 * words and symbols are ignored. Something with no digits in it at all ("abc") becomes NaN rather
 * than silently disappearing, so the field it came from gets the error message.
 */
function typedNumber(label: string, rules: { max: number; whole?: boolean }) {
  const base = z.number({ error: `${label} must be a number, like 75.` }).positive(`${label} must be more than 0.`);
  const bounded = (rules.whole ? base.int(`${label} must be a whole number.`) : base).max(
    rules.max,
    `${label} cannot be more than ${rules.max.toLocaleString("en")}.`,
  );

  return z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    const raw = String(value).trim();
    if (raw === "") return undefined;
    const digits = raw.replace(/[^\d.,]/g, "").replace(/,/g, "");
    return digits === "" ? Number.NaN : Number(digits);
  }, bounded.optional());
}

export const operatorListingInputSchema = z.object({
  title: z.string().trim().min(2, "Give the listing a title of at least 2 characters.").max(160, "The title is too long (160 characters at most)."),
  category: z.string().trim().min(2, "Enter a category, like Sailing or Diving.").max(80, "The category is too long (80 characters at most)."),
  region: z.string().trim().min(2, "Enter where the trip runs, like Brisbane.").max(120, "The region is too long (120 characters at most)."),
  description: z
    .string()
    .trim()
    .min(10, "Describe the trip in at least 10 characters, so travellers know what they are booking.")
    .max(4000, "The description is too long (4,000 characters at most)."),
  heroImageUrl: z.string().trim().max(500, "The photo link is too long.").optional(),
  maxGuests: typedNumber("Max guests", { max: 500, whole: true }),
  priceSignal: z.string().trim().max(120, "The custom price text is too long (120 characters at most).").optional(),
  /* Not optional in practice, even though the column is nullable: fetchSyncedTrips() only ever
     shows a listing with `priceFrom: { not: null }` on Discover, since Trip.price backs both the
     "A$X/guest" display and the 5%-conservation-split math there, un-guarded. A self-service
     listing with no priceFrom saves fine and shows on the operator's own dashboard, but never
     reaches a traveller - discovered live (2026-08-24) the first time this schema was driven by a
     real form instead of only the Rezdy sync, which always supplies one. */
  priceFrom: typedNumber("Price per guest", { max: 1_000_000 }),
  currency: z.string().trim().length(3, "The currency must be a 3 letter code, like AUD.").optional(),
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
