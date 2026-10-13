import { prisma } from "@/lib/db/prisma";
import { localDateInZone } from "@/lib/services/operators/listing-availability";
import { rezdyConfig, rezdyApi } from "@/lib/services/channels/rezdy/api";
import { rezdyDay, rezdyHeadline, rezdyMonth, type RezdyTrip } from "@/lib/services/channels/rezdy/booking";
import { paymentMode, productIssue, questionsFor, type RezdyPaymentMode } from "@/lib/services/channels/rezdy/map";
import { ensureRezdyProduct } from "@/lib/services/channels/rezdy/sync";
import { fareHarborAffiliate, type FareHarborLink } from "@/lib/services/channels/fareharbor/links";
import { fareHarborLinkOf } from "@/lib/services/channels/fareharbor/connect";
import { NO_QUESTIONS, type ChannelQuestions } from "@/lib/services/channels/types";
import { bookableListing, dayOptions, headlinePrice, monthAvailability, type BookableListing } from "@/lib/services/rails/public";
import { DEFAULT_ZONE } from "@/lib/services/rails/views";

/**
 * Any trip a traveller can book, whatever holds its seats. The booking page, the
 * widget and the agent API all start here, so a trip sells the same way everywhere.
 */

type ListingFace = {
  id: string;
  slug: string;
  title: string;
  description: string;
  region: string;
  heroImageUrl: string | null;
  meetingPoint: string | null;
  confirmationNote: string | null;
  durationMinutes: number | null;
  currency: string;
  operatorProfileId: string;
  priceFrom: number | null;
};

export type NativeTrip = { kind: "native"; operatorName: string; timezone: string; cutoffHours: number; native: BookableListing; listing: ListingFace };

export type RezdyBookable = {
  kind: "rezdy";
  operatorName: string;
  timezone: string;
  cutoffHours: number;
  listing: ListingFace;
  trip: RezdyTrip;
  questions: ChannelQuestions;
  /** "automated": Rezdy charges the card; "agent": Bluepass's checkout takes it. */
  mode: RezdyPaymentMode;
  /** Rezdy's Stripe key, for tokenising the card in the browser. Present for automated payments. */
  cardKey: string | null;
};

export type FareHarborBookable = { kind: "fareharbor"; operatorName: string; timezone: string; cutoffHours: 0; listing: ListingFace; link: FareHarborLink };

export type BookableTrip = NativeTrip | RezdyBookable | FareHarborBookable;

const face = {
  id: true, slug: true, title: true, description: true, region: true, heroImageUrl: true, meetingPoint: true,
  confirmationNote: true, durationMinutes: true, currency: true, operatorProfileId: true, priceFrom: true,
} as const;

export async function bookableTrip(slug: string, now = new Date()): Promise<BookableTrip | null> {
  const row = await prisma.operatorListing.findUnique({
    where: { slug },
    select: {
      ...face,
      status: true,
      channel: true,
      channelIssue: true,
      channelData: true,
      channelSyncedAt: true,
      externalProductId: true,
      externalBookingUrl: true,
      operatorProfile: { select: { companyName: true, channelConnections: { select: { platform: true, timezone: true, status: true } } } },
    },
  });
  if (!row || row.status !== "LIVE") return null;
  const listing: ListingFace = {
    id: row.id, slug: row.slug, title: row.title, description: row.description, region: row.region, heroImageUrl: row.heroImageUrl,
    meetingPoint: row.meetingPoint, confirmationNote: row.confirmationNote, durationMinutes: row.durationMinutes, currency: row.currency,
    operatorProfileId: row.operatorProfileId, priceFrom: row.priceFrom,
  };
  const operatorName = row.operatorProfile.companyName ?? row.title;

  if (row.channel === "REZDY") {
    if (row.channelIssue || !rezdyConfig()) return null;
    const data = await ensureRezdyProduct(row, rezdyApi(), now);
    if (!data || productIssue(data.product)) return null;
    const mode = paymentMode(data.product);
    if (!mode) return null;
    const connection = row.operatorProfile.channelConnections.find((c) => c.platform === "REZDY");
    const timezone = data.product.timezone || connection?.timezone || DEFAULT_ZONE;
    return {
      kind: "rezdy",
      operatorName,
      timezone,
      cutoffHours: Math.ceil(Math.max(0, data.product.minimumNoticeMinutes ?? 0) / 60),
      listing: { ...listing, confirmationNote: listing.confirmationNote },
      trip: { listing: { id: row.id, slug: row.slug, title: row.title, operatorProfileId: row.operatorProfileId, currency: row.currency }, data, timezone, operatorName },
      questions: questionsFor(data.product, data.pickups),
      mode,
      cardKey: mode === "automated" ? rezdyConfig()!.stripePublishableKey : null,
    };
  }

  if (row.channel === "FAREHARBOR") {
    if (row.channelIssue || !fareHarborAffiliate()) return null;
    const link = fareHarborLinkOf(row);
    if (!link?.itemId) return null;
    return { kind: "fareharbor", operatorName, timezone: DEFAULT_ZONE, cutoffHours: 0, listing, link };
  }

  const native = await bookableListing(slug);
  if (!native) return null;
  return { kind: "native", operatorName, timezone: native.timezone, cutoffHours: native.cutoffHours, native, listing };
}

export function tripHeadline(t: BookableTrip, now = new Date()): number | null {
  if (t.kind === "native") return headlinePrice(t.native, localDateInZone(now, t.timezone));
  if (t.kind === "rezdy") return rezdyHeadline(t.trip.data.product);
  return t.listing.priceFrom ? Math.round(t.listing.priceFrom * 100) : null;
}

export async function tripMonth(t: NativeTrip | RezdyBookable, month: string, now = new Date()) {
  return t.kind === "native" ? monthAvailability(t.native, month, now) : rezdyMonth(t.trip, month, now);
}

export async function tripDay(t: NativeTrip | RezdyBookable, date: string, guests?: number, now = new Date()) {
  return t.kind === "native" ? dayOptions(t.native, date, guests, now) : rezdyDay(t.trip, date, now);
}

/** The first month worth opening the calendar on: this one, or the next if this one has nothing free. */
export async function openingMonth(t: NativeTrip | RezdyBookable, now = new Date()) {
  const today = localDateInZone(now, t.timezone);
  const first = await tripMonth(t, today.slice(0, 7), now);
  if (first.days.some((d) => d.status === "available")) return first;
  const [y, m] = today.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return tripMonth(t, next, now);
}

/** What the booking card needs to ask for and how it takes payment, per channel. */
export function checkoutFor(t: NativeTrip | RezdyBookable) {
  if (t.kind === "native") return { questions: NO_QUESTIONS, payment: { kind: "checkout" as const }, cutoffHours: t.cutoffHours };
  return {
    questions: t.questions,
    payment: t.mode === "automated" ? { kind: "card" as const, publishableKey: t.cardKey! } : { kind: "checkout" as const },
    cutoffHours: t.cutoffHours,
  };
}
