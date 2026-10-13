import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { placeholderProfileFor, preparedTrip, type PreparedTripData } from "@/lib/services/operators/prepared-pages";

/**
 * A prepared page becomes bookable on its own. Once the operator has claimed it and
 * connected Rezdy, each trip on the page is matched to the operator's Rezdy trip of the
 * same name, and travellers book it through Bluepass instead of being sent to the
 * operator's website. Nobody at Bluepass does the matching.
 *
 * A match is made only when it is clear: the names agree closely, no other Rezdy trip
 * comes near, and each Rezdy trip is used once. Anything less is left for the operator,
 * who sees every match on their page and can change it; their choice is never undone by
 * the next sync.
 */

const FILLER = new Set(["the", "a", "an", "and", "with", "of", "in", "on", "at", "to", "for", "from", "by", "tour", "tours", "trip", "trips", "experience"]);
const CLEAR = 0.6;
const MARGIN = 0.1;

function words(name: string) {
  return new Set(
    name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ")
      .filter((w) => w && !FILLER.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

/** How alike two trip names are, from 0 to 1 (the share of their words in common). */
export function nameMatch(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return (2 * shared) / (x.size + y.size);
}

type Trip = { id: string; names: string[] };
type Product = { id: string; name: string };

/** Pairs trips with products where the match is clear; the rest stay unpaired. */
export function pairByName(trips: Trip[], products: Product[]): Map<string, string> {
  const score = (t: Trip, p: Product) => Math.max(...t.names.map((n) => nameMatch(n, p.name)));
  const pairs = trips.flatMap((t) => products.map((p) => ({ t, p, s: score(t, p) }))).filter((x) => x.s >= CLEAR).sort((a, b) => b.s - a.s);
  const chosen = new Map<string, string>();
  const taken = new Set<string>();
  for (const { t, p, s } of pairs) {
    if (chosen.has(t.id) || taken.has(p.id)) continue;
    // Too close to call between two Rezdy trips, or two trips on the page: leave it to the operator.
    const rival = Math.max(0, ...products.filter((o) => o.id !== p.id && !taken.has(o.id)).map((o) => score(t, o)));
    const rivalTrip = Math.max(0, ...trips.filter((o) => o.id !== t.id && !chosen.has(o.id)).map((o) => score(o, p)));
    if (s - rival < MARGIN || s - rivalTrip < MARGIN) continue;
    chosen.set(t.id, p.id);
    taken.add(p.id);
  }
  return chosen;
}

const PLACEHOLDER = /@ops\.bluepass\.co$/i;

/** The prepared page this operator profile has claimed, when the claim is approved. */
async function claimedPage(operatorProfileId: string) {
  const profile = await prisma.operatorProfile.findUnique({
    where: { id: operatorProfileId },
    select: { id: true, status: true, claimedOperatorSlug: true, account: { select: { email: true } } },
  });
  const slug = profile?.claimedOperatorSlug;
  if (!profile || !slug || profile.status !== "APPROVED" || PLACEHOLDER.test(profile.account.email)) return null;
  const holder = await placeholderProfileFor(slug);
  if (!holder) return null;
  const listings = await prisma.operatorListing.findMany({ where: { operatorProfileId: holder.id, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "asc" } });
  const trips = listings.flatMap((l) => {
    const data = preparedTrip(l);
    return data ? [{ listing: l, data }] : [];
  });
  return { slug, profile, trips };
}

async function rezdyTripsOf(operatorProfileId: string) {
  return prisma.operatorListing.findMany({
    where: { operatorProfileId, channel: "REZDY", externalProductId: { not: null }, status: { not: "ARCHIVED" } },
    select: { id: true, title: true, slug: true, status: true, channelIssue: true },
    orderBy: { title: "asc" },
  });
}

async function saveBooking(listingId: string, data: PreparedTripData, booking: PreparedTripData["booking"]) {
  await prisma.operatorListing.update({
    where: { id: listingId },
    data: { channelData: { ...data, booking } as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Matches a claimed page's trips to the operator's Rezdy trips. Runs after every Rezdy
 * sync; trips the operator matched themselves are left as they set them.
 */
export async function linkPreparedTrips(operatorProfileId: string, now = new Date()) {
  const claimed = await claimedPage(operatorProfileId);
  if (!claimed) return null;
  const products = await rezdyTripsOf(operatorProfileId);
  const productIds = new Set(products.map((p) => p.id));
  const byOperator = claimed.trips.filter((t) => t.data.booking?.by === "operator");
  const takenByOperator = new Set(byOperator.map((t) => t.data.booking?.listingId).filter(Boolean));
  const open = claimed.trips.filter((t) => t.data.booking?.by !== "operator");
  const pairs = pairByName(
    open.map((t) => ({ id: t.listing.id, names: [t.data.page.title, t.listing.title] })),
    products.filter((p) => !takenByOperator.has(p.id)).map((p) => ({ id: p.id, name: p.title })),
  );
  let linked = 0;
  for (const t of open) {
    const listingId = pairs.get(t.listing.id) ?? null;
    const current = t.data.booking?.listingId ?? null;
    if (listingId) linked += 1;
    // A Rezdy trip that is no longer there unlinks; an unchanged match is left alone.
    if (listingId === current && (!current || productIds.has(current))) continue;
    await saveBooking(t.listing.id, t.data, listingId ? { listingId, by: "name", at: now.toISOString() } : null);
  }
  return { linked: linked + byOperator.filter((t) => t.data.booking?.listingId).length, trips: claimed.trips.length };
}

/** What the operator sees: each trip on their page and the Rezdy trip it books through. */
export async function preparedBookingFor(accountId: string) {
  const profile = await prisma.operatorProfile.findUnique({ where: { accountId }, select: { id: true } });
  if (!profile) return null;
  const claimed = await claimedPage(profile.id);
  if (!claimed) return null;
  const [products, connection] = await Promise.all([
    rezdyTripsOf(profile.id),
    prisma.operatorChannelConnection.findUnique({ where: { operatorProfileId_platform: { operatorProfileId: profile.id, platform: "REZDY" } }, select: { status: true } }),
  ]);
  return {
    connected: Boolean(connection),
    products: products.map((p) => ({ id: p.id, title: p.title, sells: p.status === "LIVE" && !p.channelIssue })),
    trips: claimed.trips.map((t) => ({
      id: t.listing.id,
      title: t.listing.title,
      listingId: t.data.booking?.listingId ?? null,
      by: t.data.booking?.by ?? null,
    })),
  };
}

/** The operator's own matches. "none" says a trip is not on Rezdy. */
export async function choosePreparedBooking(input: { accountId: string; choices: Record<string, string> }) {
  const profile = await prisma.operatorProfile.findUnique({ where: { accountId: input.accountId }, select: { id: true } });
  const claimed = profile ? await claimedPage(profile.id) : null;
  if (!profile || !claimed) return { ok: false as const, message: "There is no approved Bluepass page on your account." };
  const products = new Set((await rezdyTripsOf(profile.id)).map((p) => p.id));
  const chosen = Object.values(input.choices).filter((v) => v !== "none");
  if (new Set(chosen).size !== chosen.length) return { ok: false as const, message: "Each Rezdy trip can book one trip on your page. Two are set to the same one." };
  const now = new Date().toISOString();
  let changed = 0;
  for (const t of claimed.trips) {
    const choice = input.choices[t.listing.id];
    if (choice === undefined) continue;
    if (choice !== "none" && !products.has(choice)) return { ok: false as const, message: "That Rezdy trip is not on your account." };
    const listingId = choice === "none" ? null : choice;
    if (t.data.booking?.by === "operator" && t.data.booking.listingId === listingId) continue;
    await saveBooking(t.listing.id, t.data, { listingId, by: "operator", at: now });
    changed += 1;
  }
  return { ok: true as const, message: changed ? "Saved. Matched trips book through Rezdy on your page." : "Nothing changed." };
}
