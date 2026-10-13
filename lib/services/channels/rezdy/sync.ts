import type { OperatorChannelConnection, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { rezdyApi, RezdyError, type RezdyApi, type RezdyCompany, type RezdyPickup, type RezdyProduct } from "@/lib/services/channels/rezdy/api";
import { parseRezdyAlias, productIssue, productToListing } from "@/lib/services/channels/rezdy/map";
import { sameBusinessDomain, sameBusinessName, uniqueListingSlug } from "@/lib/services/channels/listings";
import { linkPreparedTrips } from "@/lib/services/operators/prepared-booking";

/**
 * Keeps an operator's Rezdy trips on Bluepass without anyone retyping them.
 *
 * The operator connects once by naming their Rezdy account. Every Rezdy product they
 * share with Bluepass's agent account becomes a Bluepass trip; a new product appears
 * by itself, a changed one updates, and one they stop sharing stops selling. Seats,
 * prices and booking questions are never copied into Bluepass's own rails: they are
 * read from Rezdy when a traveller books, so Rezdy stays the only inventory.
 */

export type ChannelResult = { ok: true; message: string } | { ok: false; message: string };

/** What a Rezdy trip keeps in OperatorListing.channelData. */
export type RezdyListingData = { product: RezdyProduct; pickups: RezdyPickup[] };

export function rezdyData(listing: { channelData: Prisma.JsonValue | null }): RezdyListingData | null {
  const data = listing.channelData as Partial<RezdyListingData> | null;
  return data?.product?.productCode ? { product: data.product, pickups: data.pickups ?? [] } : null;
}

const PLACEHOLDER_EMAIL = /^rezdy\+\d+@ops\.bluepass\.co$/i;

/** The steps an operator follows in Rezdy so their trips reach Bluepass. Shown on the Connections page. */
export const REZDY_SHARE_STEPS = [
  "In Rezdy, open Marketplace and find Bluepass under agents.",
  "Give Bluepass a rate on the trips you want sold here. Automated payments or full payment to agent both work.",
  "Come back and press Check again. Trips appear here within a minute of Rezdy sharing them.",
];

async function describeRezdyError(error: unknown) {
  if (error instanceof RezdyError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether the operator signed in is the business behind a Rezdy account. Without this
 * anyone could type a competitor's address and have that competitor's trips, and on
 * full-payment-to-agent rates their payouts, land in the wrong account. The anchors
 * are ones operators cannot edit themselves: the name Bluepass approved, the domain
 * of the address they signed up with, and a supplier id Bluepass already matched.
 */
function ownsAccount(input: {
  profile: { companyName: string | null; websiteUrl: string | null; rezdySupplierId: string | null };
  accountEmail: string;
  company: RezdyCompany;
  supplierId: string | null;
}) {
  const { profile, company } = input;
  if (input.supplierId && profile.rezdySupplierId === input.supplierId) return true;
  if (sameBusinessName(profile.companyName, company.companyName)) return true;
  if (company.website && (sameBusinessDomain(input.accountEmail, company.website) || sameBusinessDomain(profile.websiteUrl, company.website))) return true;
  return false;
}

/**
 * A Rezdy supplier the Discover sync found before the operator signed up lives on a
 * placeholder profile nobody can sign in to. When the real operator connects, their
 * trips, and any bookings already taken on them, move to the operator's own account.
 */
async function adoptPlaceholder(supplierId: string, operatorProfileId: string) {
  const holder = await prisma.operatorProfile.findUnique({
    where: { rezdySupplierId: supplierId },
    select: { id: true, account: { select: { email: true } } },
  });
  if (!holder || holder.id === operatorProfileId) return { ok: true as const };
  if (!PLACEHOLDER_EMAIL.test(holder.account.email)) {
    return { ok: false as const, message: "That Rezdy account is already connected to another Bluepass operator." };
  }
  await prisma.$transaction([
    prisma.operatorListing.updateMany({ where: { operatorProfileId: holder.id }, data: { operatorProfileId } }),
    prisma.listingBooking.updateMany({ where: { operatorProfileId: holder.id }, data: { operatorProfileId } }),
    prisma.channelHandoff.updateMany({ where: { operatorProfileId: holder.id }, data: { operatorProfileId } }),
    prisma.operatorChannelConnection.deleteMany({ where: { operatorProfileId: holder.id } }),
    prisma.operatorProfile.update({
      where: { id: holder.id },
      data: { rezdySupplierId: null, notes: `Claimed by operator profile ${operatorProfileId} on ${new Date().toISOString().slice(0, 10)}.` },
    }),
  ]);
  return { ok: true as const };
}

/**
 * Connects the signed-in operator's Rezdy account from whatever they type: the alias,
 * their booking page address, or a product link. If they have not shared any trips
 * with Bluepass yet the connection waits, and the next sync picks them up as soon as
 * they do.
 */
export async function connectRezdy(
  input: { operatorProfileId: string; accountEmail: string; address: string; now?: Date },
  api: RezdyApi | null = rezdyApi(),
): Promise<ChannelResult> {
  if (!api) return { ok: false, message: "Rezdy is not switched on for Bluepass yet." };
  const alias = parseRezdyAlias(input.address);
  if (!alias) return { ok: false, message: "That does not look like a Rezdy address. It is the name before .rezdy.com on your booking page." };

  let company: RezdyCompany | null;
  let products: RezdyProduct[];
  try {
    company = await api.company(alias);
    if (!company) return { ok: false, message: `There is no Rezdy account at ${alias}.rezdy.com.` };
    products = await api.marketplaceProducts({ supplierAlias: alias });
  } catch (error) {
    return { ok: false, message: `Rezdy did not answer: ${await describeRezdyError(error)}` };
  }

  const supplierId = products[0]?.supplierId ? String(products[0].supplierId) : null;
  const profile = await prisma.operatorProfile.findUniqueOrThrow({
    where: { id: input.operatorProfileId },
    select: { companyName: true, websiteUrl: true, rezdySupplierId: true },
  });
  if (!ownsAccount({ profile, accountEmail: input.accountEmail, company, supplierId })) {
    return {
      ok: false,
      message: `That Rezdy account belongs to ${company.companyName}, and nothing ties it to ${profile.companyName ?? "your Bluepass account"}. Sign in with an address at your business's own domain, or reply to your Bluepass welcome email from the address on your Rezdy account.`,
    };
  }

  const taken = await prisma.operatorChannelConnection.findUnique({ where: { platform_accountKey: { platform: "REZDY", accountKey: alias } } });
  if (taken && taken.operatorProfileId !== input.operatorProfileId) {
    const holder = await prisma.operatorProfile.findUnique({ where: { id: taken.operatorProfileId }, select: { account: { select: { email: true } } } });
    if (!holder || !PLACEHOLDER_EMAIL.test(holder.account.email)) {
      return { ok: false, message: "That Rezdy account is already connected to another Bluepass operator." };
    }
  }
  if (supplierId) {
    const adopted = await adoptPlaceholder(supplierId, input.operatorProfileId);
    if (!adopted.ok) return adopted;
  }

  const connection = await prisma.operatorChannelConnection.upsert({
    where: { operatorProfileId_platform: { operatorProfileId: input.operatorProfileId, platform: "REZDY" } },
    create: {
      operatorProfileId: input.operatorProfileId,
      platform: "REZDY",
      accountKey: alias,
      externalId: supplierId,
      displayName: company.companyName,
      timezone: company.timezone ?? null,
      currency: company.currency ?? null,
      status: products.length ? "CONNECTED" : "WAITING",
      lastCheckedAt: input.now ?? new Date(),
    },
    update: {
      accountKey: alias,
      externalId: supplierId,
      displayName: company.companyName,
      timezone: company.timezone ?? null,
      currency: company.currency ?? null,
      status: products.length ? "CONNECTED" : "WAITING",
      lastError: null,
      lastCheckedAt: input.now ?? new Date(),
    },
  });
  if (supplierId && profile.rezdySupplierId !== supplierId) {
    await prisma.operatorProfile.update({ where: { id: input.operatorProfileId }, data: { rezdySupplierId: supplierId } });
  }

  if (!products.length) {
    return { ok: true, message: `Found ${company.companyName} on Rezdy. Share your trips with Bluepass there and they will appear here.` };
  }
  const result = await importProducts(connection, products, api, input.now);
  return { ok: true, message: `Connected ${company.companyName}. ${result.created + result.updated} ${result.created + result.updated === 1 ? "trip" : "trips"} from Rezdy.` };
}

export type SyncCounts = { seen: number; created: number; updated: number; withdrawn: number };

/** Writes products into listings. Content and prices follow Rezdy; the operator's own choices (category, shown or hidden) stay. */
async function importProducts(
  connection: Pick<OperatorChannelConnection, "id" | "operatorProfileId" | "autoPublish">,
  products: RezdyProduct[],
  api: RezdyApi,
  now = new Date(),
): Promise<SyncCounts> {
  const counts: SyncCounts = { seen: 0, created: 0, updated: 0, withdrawn: 0 };
  const seen = new Set<string>();

  for (const product of products) {
    if (!product.productCode || !product.name) continue;
    counts.seen += 1;
    seen.add(product.productCode);

    const existing = await prisma.operatorListing.findFirst({
      where: { channel: "REZDY", externalProductId: product.productCode },
      select: { id: true, operatorProfileId: true, channelData: true },
    });
    if (existing && existing.operatorProfileId !== connection.operatorProfileId) continue;

    // Pickups change rarely and cost a call each; read them again only when the product has changed.
    const stored = existing ? rezdyData(existing) : null;
    let pickups = stored?.pickups ?? [];
    if (product.pickupId && (!stored || stored.product.dateUpdated !== product.dateUpdated || !stored.pickups.length)) {
      pickups = await api.pickups(product.productCode).catch(() => stored?.pickups ?? []);
    }
    if (!product.pickupId) pickups = [];

    const fields = productToListing(product);
    const issue = productIssue(product);
    const channelData = { product, pickups } as unknown as Prisma.InputJsonValue;

    if (existing) {
      const { category: _category, ...rest } = fields;
      await prisma.operatorListing.update({
        where: { id: existing.id },
        data: { ...rest, channel: "REZDY", channelData, channelSyncedAt: now, channelIssue: issue },
      });
      counts.updated += 1;
    } else {
      const live = connection.autoPublish && !issue;
      await prisma.operatorListing.create({
        data: {
          ...fields,
          operatorProfileId: connection.operatorProfileId,
          slug: await uniqueListingSlug(fields.title),
          channel: "REZDY",
          externalProductId: product.productCode,
          channelData,
          channelSyncedAt: now,
          channelIssue: issue,
          status: live ? "LIVE" : "DRAFT",
          publishedAt: live ? now : null,
        },
      });
      counts.created += 1;
    }
  }

  const withdrawn = await prisma.operatorListing.updateMany({
    where: {
      operatorProfileId: connection.operatorProfileId,
      channel: "REZDY",
      externalProductId: { notIn: [...seen] },
      OR: [{ channelIssue: null }, { channelIssue: { not: WITHDRAWN } }],
    },
    data: { channelIssue: WITHDRAWN, channelSyncedAt: now },
  });
  counts.withdrawn = withdrawn.count;
  // An operator who claimed a page Bluepass prepared: its trips now book through these.
  await linkPreparedTrips(connection.operatorProfileId, now);
  return counts;
}

const WITHDRAWN = "No longer shared with Bluepass in Rezdy. Give Bluepass a rate on it again to sell it here.";
const DISCONNECTED = "Rezdy is disconnected. Connect it again to sell this trip.";
const SHARE_ISSUES = new Set([WITHDRAWN, DISCONNECTED]);

/** One connection, brought up to date with Rezdy. */
export async function syncRezdyConnection(connection: OperatorChannelConnection, api: RezdyApi, now = new Date()): Promise<SyncCounts | null> {
  try {
    const products = await api.marketplaceProducts(
      connection.externalId ? { supplierId: connection.externalId } : { supplierAlias: connection.accountKey },
    );
    const supplierId = products[0]?.supplierId ? String(products[0].supplierId) : connection.externalId;
    const counts = await importProducts(connection, products, api, now);
    await prisma.operatorChannelConnection.update({
      where: { id: connection.id },
      data: {
        externalId: supplierId,
        status: products.length ? "CONNECTED" : connection.status === "CONNECTED" ? "BROKEN" : "WAITING",
        lastError: products.length ? null : connection.status === "CONNECTED" ? "Rezdy is no longer sharing any trips with Bluepass." : null,
        lastSyncedAt: now,
        lastCheckedAt: now,
      },
    });
    if (supplierId && supplierId !== connection.externalId) {
      await prisma.operatorProfile.updateMany({ where: { id: connection.operatorProfileId, rezdySupplierId: null }, data: { rezdySupplierId: supplierId } });
    }
    return counts;
  } catch (error) {
    const transient = error instanceof RezdyError && error.transient;
    await prisma.operatorChannelConnection.update({
      where: { id: connection.id },
      data: { lastCheckedAt: now, lastError: await describeRezdyError(error), ...(transient ? {} : { status: "BROKEN" as const }) },
    });
    return null;
  }
}

/** Every Rezdy connection, oldest first, a bounded number per run so Rezdy's rate limit is never the thing that breaks. */
export async function runRezdyChannelSync(now = new Date(), api: RezdyApi | null = rezdyApi(), limit = 40) {
  if (!api) return { skipped: "REZDY_API_KEY is not set." };
  const connections = await prisma.operatorChannelConnection.findMany({
    where: { platform: "REZDY" },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }],
    take: limit,
  });
  const totals = { connections: 0, failed: 0, created: 0, updated: 0, withdrawn: 0 };
  for (const connection of connections) {
    const counts = await syncRezdyConnection(connection, api, now);
    totals.connections += 1;
    if (!counts) { totals.failed += 1; continue; }
    totals.created += counts.created;
    totals.updated += counts.updated;
    totals.withdrawn += counts.withdrawn;
  }
  return totals;
}

/** "Check again" and "Sync now" on the Connections page. */
export async function syncOperatorRezdy(operatorProfileId: string, api: RezdyApi | null = rezdyApi(), now = new Date()): Promise<ChannelResult> {
  if (!api) return { ok: false, message: "Rezdy is not switched on for Bluepass yet." };
  const connection = await prisma.operatorChannelConnection.findUnique({
    where: { operatorProfileId_platform: { operatorProfileId, platform: "REZDY" } },
  });
  if (!connection) return { ok: false, message: "Connect your Rezdy account first." };
  const counts = await syncRezdyConnection(connection, api, now);
  if (!counts) {
    const fresh = await prisma.operatorChannelConnection.findUniqueOrThrow({ where: { id: connection.id } });
    return { ok: false, message: fresh.lastError ?? "Rezdy did not answer. Try again in a minute." };
  }
  if (counts.seen === 0) return { ok: true, message: "Rezdy is not sharing any trips with Bluepass yet." };
  const parts = [`${counts.seen} ${counts.seen === 1 ? "trip" : "trips"} from Rezdy`];
  if (counts.created) parts.push(`${counts.created} new`);
  if (counts.withdrawn) parts.push(`${counts.withdrawn} no longer shared`);
  return { ok: true, message: `Up to date. ${parts.join(", ")}.` };
}

export async function disconnectRezdy(operatorProfileId: string): Promise<ChannelResult> {
  const connection = await prisma.operatorChannelConnection.findUnique({
    where: { operatorProfileId_platform: { operatorProfileId, platform: "REZDY" } },
  });
  if (!connection) return { ok: true, message: "Rezdy was not connected." };
  await prisma.$transaction([
    prisma.operatorListing.updateMany({
      where: { operatorProfileId, channel: "REZDY" },
      data: { channelIssue: DISCONNECTED },
    }),
    prisma.operatorChannelConnection.delete({ where: { id: connection.id } }),
  ]);
  return { ok: true, message: "Rezdy disconnected. Your Rezdy trips have stopped selling on Bluepass; bookings already made stand." };
}

export async function setRezdyAutoPublish(operatorProfileId: string, autoPublish: boolean): Promise<ChannelResult> {
  await prisma.operatorChannelConnection.update({
    where: { operatorProfileId_platform: { operatorProfileId, platform: "REZDY" } },
    data: { autoPublish },
  });
  return { ok: true, message: autoPublish ? "New Rezdy trips will sell here as soon as you share them." : "New Rezdy trips will wait here for you to switch them on." };
}

/**
 * A Rezdy trip's product, fresh enough to sell from. Trips made by the Discover sync
 * before this existed carry only a product code; the first booking page that opens
 * one fills in the rest. Product details change rarely, so six hours is fresh enough;
 * seats and prices are always read live.
 */
export async function ensureRezdyProduct(
  listing: {
    id: string;
    channel: string;
    externalProductId: string | null;
    channelData: Prisma.JsonValue | null;
    channelSyncedAt: Date | null;
    channelIssue: string | null;
  },
  api: RezdyApi | null = rezdyApi(),
  now = new Date(),
): Promise<RezdyListingData | null> {
  const stored = rezdyData(listing);
  const fresh = stored && listing.channelSyncedAt && now.getTime() - listing.channelSyncedAt.getTime() < 6 * 3_600_000;
  if (fresh || !api || listing.channel !== "REZDY" || !listing.externalProductId) return stored;
  try {
    const product = await api.product(listing.externalProductId);
    if (!product) {
      await prisma.operatorListing.update({ where: { id: listing.id }, data: { channelIssue: WITHDRAWN, channelSyncedAt: now } });
      return null;
    }
    const pickups = product.pickupId ? await api.pickups(product.productCode).catch(() => stored?.pickups ?? []) : [];
    // Whether Bluepass may still sell it is the connection sync's call, made from what
    // Rezdy shares; reading one product only refreshes what it says about itself.
    const shareIssue = listing.channelIssue && SHARE_ISSUES.has(listing.channelIssue) ? listing.channelIssue : null;
    await prisma.operatorListing.update({
      where: { id: listing.id },
      data: {
        channelData: { product, pickups } as unknown as Prisma.InputJsonValue,
        channelSyncedAt: now,
        channelIssue: shareIssue ?? productIssue(product),
      },
    });
    return { product, pickups };
  } catch {
    // Rezdy being slow should not take the booking page down; the stored copy still sells.
    return stored;
  }
}
