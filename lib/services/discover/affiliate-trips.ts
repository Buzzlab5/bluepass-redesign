import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { buildUniqueListingSlug, normalizeOptionalUrl } from "@/lib/services/operators/operator-listing-service";
import { normalizeSlug } from "@/lib/services/operators/operator-leads";

/**
 * Trips BluePass resells as a FareHarbor affiliate or a Rezdy agent. The traveller books on the
 * platform's own booking page (live times, payment, confirmation), opened from the trip sheet, so
 * no payment touches BluePass and Kai does not hold seats for these. An admin adds them by hand:
 * an affiliate has no API, so each trip's booking link is copied from FareHarbor's Marketplace or
 * Rezdy's agent tools.
 */

export const AFFILIATE_PLATFORMS = ["FAREHARBOR", "REZDY"] as const;
export type AffiliatePlatform = (typeof AFFILIATE_PLATFORMS)[number];

/** Hosts each platform's booking pages live on. Anything else is refused, so a typo or a pasted
    operator website never becomes a "Book now" button that goes somewhere unexpected. */
const PLATFORM_HOSTS: Record<AffiliatePlatform, RegExp> = {
  FAREHARBOR: /^(?:[a-z0-9-]+\.)*fareharbor\.com$/i,
  REZDY: /^(?:[a-z0-9-]+\.)*rezdy\.com$/i,
};

export const PLATFORM_LABELS: Record<AffiliatePlatform, string> = {
  FAREHARBOR: "FareHarbor",
  REZDY: "Rezdy",
};

/**
 * The booking link as it will be used, or a reason it cannot be. The link is kept exactly as
 * pasted (FareHarbor's affiliate guide: "Do not modify the generated URL"), only checked.
 */
export function parseAffiliateBookingUrl(
  platform: AffiliatePlatform,
  raw: string,
): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "Paste the full booking link, starting with https://." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, message: "The booking link must start with https://." };
  }
  if (!PLATFORM_HOSTS[platform].test(url.hostname)) {
    return {
      ok: false,
      message: `That is not a ${PLATFORM_LABELS[platform]} link. Copy the booking link from ${PLATFORM_LABELS[platform]} itself.`,
    };
  }
  return { ok: true, url: trimmed };
}

export const affiliateTripInputSchema = z.object({
  operatorName: z.string().trim().min(2, "Enter the operator's name.").max(160),
  title: z.string().trim().min(2, "Enter the trip name.").max(160),
  category: z.string().trim().min(2, "Enter a category.").max(80),
  region: z.string().trim().min(2, "Enter a region.").max(120),
  description: z.string().trim().min(10, "Write at least a sentence about the trip.").max(4000),
  heroImageUrl: z.string().trim().max(500).optional(),
  priceFrom: z.coerce.number().positive("Enter the lowest adult price.").max(1_000_000),
  currency: z.string().trim().length(3).optional(),
  bookingPlatform: z.enum(AFFILIATE_PLATFORMS),
  bookingUrl: z.string().trim().min(1, "Paste the booking link."),
});

export type AffiliateTripInput = z.infer<typeof affiliateTripInputSchema>;

/**
 * The operator profile an affiliate trip hangs off. These operators sell through FareHarbor or
 * Rezdy and have never signed up with BluePass, so this reuses a profile with exactly that company
 * name when there is one, and otherwise creates a placeholder (unusable password, synthetic email),
 * the same trade-off the Rezdy marketplace sync made. Two profiles with the same name means the
 * name identifies nobody, so a new placeholder is created rather than guessing.
 */
async function findOrCreateAffiliateOperatorProfile(operatorName: string, platform: AffiliatePlatform) {
  const matches = await prisma.operatorProfile.findMany({
    where: { companyName: { equals: operatorName, mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  if (matches.length === 1) return matches[0].id;

  const handle = `${normalizeSlug(operatorName) || "operator"}-${randomBytes(3).toString("hex")}`;
  const account = await prisma.bluePassAccount.create({
    data: {
      email: `${platform.toLowerCase()}+${handle}@ops.bluepass.co`,
      passwordHash: randomBytes(32).toString("hex"),
      displayName: operatorName,
      roles: ["OPERATOR"],
    },
  });
  const profile = await prisma.operatorProfile.create({
    data: {
      accountId: account.id,
      companyName: operatorName,
      status: "LIVE",
      country: "AU",
      notes: `Added by an admin as a ${PLATFORM_LABELS[platform]} ${platform === "FAREHARBOR" ? "affiliate" : "agent"} operator on ${new Date().toISOString().slice(0, 10)}.`,
    },
  });
  return profile.id;
}

export type CreateAffiliateTripResult =
  | { ok: true; listingId: string; slug: string }
  | { ok: false; message: string; field?: string };

/** Adds an affiliate trip and publishes it straight away: it is bookable the moment it exists. */
export async function createAffiliateTrip(raw: Record<string, unknown>): Promise<CreateAffiliateTripResult> {
  const parsed = affiliateTripInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? "Check the form and try again.", field: issue?.path[0]?.toString() };
  }
  const input = parsed.data;

  const booking = parseAffiliateBookingUrl(input.bookingPlatform, input.bookingUrl);
  if (!booking.ok) return { ok: false, message: booking.message, field: "bookingUrl" };

  const operatorProfileId = await findOrCreateAffiliateOperatorProfile(input.operatorName, input.bookingPlatform);
  const currency = input.currency?.toUpperCase() || "AUD";
  const slug = await buildUniqueListingSlug(input.title);
  const now = new Date();

  const listing = await prisma.operatorListing.create({
    data: {
      operatorProfileId,
      slug,
      title: input.title,
      category: input.category,
      region: input.region,
      description: input.description,
      heroImageUrl: normalizeOptionalUrl(input.heroImageUrl),
      priceFrom: input.priceFrom,
      priceSignal: `From ${currency} ${input.priceFrom}`,
      currency,
      bookingPlatform: input.bookingPlatform,
      bookingUrl: booking.url,
      status: "LIVE",
      publishedAt: now,
    },
  });

  return { ok: true, listingId: listing.id, slug: listing.slug };
}

export type AffiliateTripRow = {
  id: string;
  slug: string;
  title: string;
  operatorName: string;
  region: string;
  priceSignal: string | null;
  bookingPlatform: AffiliatePlatform;
  bookingUrl: string;
  status: string;
  createdAt: Date;
};

export async function listAffiliateTrips(): Promise<AffiliateTripRow[]> {
  const rows = await prisma.operatorListing.findMany({
    where: { bookingUrl: { not: null }, bookingPlatform: { in: [...AFFILIATE_PLATFORMS] } },
    orderBy: { createdAt: "desc" },
    include: { operatorProfile: { select: { companyName: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    operatorName: row.operatorProfile.companyName ?? "Unknown operator",
    region: row.region,
    priceSignal: row.priceSignal,
    bookingPlatform: row.bookingPlatform as AffiliatePlatform,
    bookingUrl: row.bookingUrl as string,
    status: row.status,
    createdAt: row.createdAt,
  }));
}

/** Takes an affiliate trip off the site, or puts it back. Only touches affiliate trips. */
export async function setAffiliateTripLive(listingId: string, live: boolean, adminEmail: string) {
  const listing = await prisma.operatorListing.findUnique({ where: { id: listingId }, select: { bookingUrl: true } });
  if (!listing?.bookingUrl) return { ok: false as const, message: "That trip was not found." };

  await prisma.operatorListing.update({
    where: { id: listingId },
    data: live
      ? { status: "LIVE", archivedAt: null, archivedBy: null, archivedReason: null, publishedAt: new Date() }
      : { status: "ARCHIVED", archivedAt: new Date(), archivedBy: adminEmail, archivedReason: "Taken down from the affiliate trips page." },
  });
  return { ok: true as const };
}

/** What Kai needs to recommend a trip and send the traveller to where it is booked. Public facts
    only: everything here is already shown on the trip page. */
export type KaiAffiliateTrip = {
  slug: string;
  title: string;
  operatorName: string;
  region: string;
  category: string;
  description: string;
  priceSignal: string | null;
  /** Set when the trip is resold on FareHarbor or Rezdy through an admin-added link. */
  bookingPlatform: AffiliatePlatform | null;
  bookingUrl: string | null;
  /** The BluePass page the traveller is sent to. Booking happens there, so Kai states no availability. */
  tripUrl: string;
};

function siteBase() {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.BLUEPASS_APP_URL || "https://bluepass.co").replace(/\/$/, "");
}

/**
 * Where Kai sends a traveller for a trip. A trip with its own schedule and price has a booking page
 * of its own; every other trip (resold on FareHarbor or Rezdy, or read from Rezdy) opens its sheet on
 * the home page, which carries the right "Book now" for its channel.
 */
export function guideTripUrl(trip: { slug: string; hasOwnSchedule: boolean }, base = siteBase()) {
  const root = base.replace(/\/$/, "");
  return trip.hasOwnSchedule ? `${root}/book/${encodeURIComponent(trip.slug)}` : `${root}/?trip=${encodeURIComponent(trip.slug)}`;
}

export async function listLiveAffiliateTripsForKai(): Promise<KaiAffiliateTrip[]> {
  const rows = await prisma.operatorListing.findMany({
    where: {
      status: "LIVE",
      priceFrom: { not: null },
      OR: [
        { bookingUrl: { not: null }, bookingPlatform: { in: [...AFFILIATE_PLATFORMS] } },
        { schedules: { some: { active: true } }, rates: { some: { active: true } } },
        { channel: "FAREHARBOR", externalBookingUrl: { not: null }, channelIssue: null },
        { channel: "REZDY", channelSyncedAt: { not: null }, channelIssue: null },
      ],
    },
    orderBy: { publishedAt: "desc" },
    include: {
      operatorProfile: { select: { companyName: true } },
      _count: { select: { schedules: { where: { active: true } }, rates: { where: { active: true } } } },
    },
  });
  const base = siteBase();
  return rows.map((row) => {
    const affiliate = (AFFILIATE_PLATFORMS as readonly string[]).includes(row.bookingPlatform ?? "") && row.bookingUrl;
    return {
      slug: row.slug,
      title: row.title,
      operatorName: row.operatorProfile.companyName ?? row.title,
      region: row.region,
      category: row.category,
      description: row.description,
      priceSignal: row.priceSignal,
      bookingPlatform: affiliate ? (row.bookingPlatform as AffiliatePlatform) : null,
      bookingUrl: affiliate ? row.bookingUrl : null,
      tripUrl: guideTripUrl({ slug: row.slug, hasOwnSchedule: row._count.schedules > 0 && row._count.rates > 0 && row.channel === "NATIVE" }, base),
    };
  });
}
