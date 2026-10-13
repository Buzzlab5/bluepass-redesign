import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { rezdyApi, type RezdyApi, type RezdyProduct } from "@/lib/services/channels/rezdy/api";
import { productIssue, productToListing } from "@/lib/services/channels/rezdy/map";
import { normalizeSlug } from "@/lib/services/operators/operator-leads";

type FetchLike = typeof fetch;

export type RezdyMarketplaceProduct = {
  productCode: string;
  name: string;
  description: string;
  supplierName: string;
  supplierId: string;
  region: string;
  priceFrom: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string | null;
  /** Rezdy's full product record. Kai passes it through; the direct read keeps it whole. */
  raw?: Record<string, unknown>;
};

export type RezdyAgentSyncEnv = Record<string, string | undefined> & {
  KAI_CORE_BASE_URL?: string;
  REZDY_AGENT_SYNC_TOKEN?: string;
};

/**
 * Pulls every Rezdy-connected operator's products through Kai's own Agent API credential (Kai
 * exposes this at GET /api/internal/rezdy-agent/marketplace-products - see that route and
 * RezdyAgentPmsAdapter.listMarketplaceProducts() in the Kai repo). Reuses KAI_CORE_BASE_URL, the
 * existing "how do we reach Kai" env var already used by lib/services/kai-core/client.ts, rather
 * than inventing a second one - only the auth token differs (REZDY_AGENT_SYNC_TOKEN, a header this
 * app sends to Kai, distinct from INTERNAL_SERVICE_TOKEN, which is what other services send to us).
 */
export async function fetchRezdyAgentMarketplaceProducts(
  env: RezdyAgentSyncEnv = process.env,
  fetchImpl: FetchLike = fetch,
  direct: RezdyApi | null = env === process.env ? rezdyApi() : null,
): Promise<RezdyMarketplaceProduct[]> {
  // With Bluepass's own Rezdy agent key in this app, read the marketplace directly
  // rather than through Kai: one less hop, and the whole product comes back.
  if (direct) return (await direct.marketplaceProducts({})).map(asMarketplaceProduct);
  const token = env.REZDY_AGENT_SYNC_TOKEN;
  if (!token) {
    throw new Error("REZDY_AGENT_SYNC_TOKEN is not configured.");
  }
  const baseUrl = (env.KAI_CORE_BASE_URL ?? "http://127.0.0.1:3107").replace(/\/$/, "");

  const response = await fetchImpl(`${baseUrl}/api/internal/rezdy-agent/marketplace-products`, {
    headers: { "x-kai-internal-token": token },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kai marketplace-products request failed with status ${response.status}.`);
  }

  const body = (await response.json()) as { products?: unknown };
  return Array.isArray(body.products) ? (body.products as RezdyMarketplaceProduct[]) : [];
}

function asMarketplaceProduct(product: RezdyProduct): RezdyMarketplaceProduct {
  const listing = productToListing(product);
  return {
    productCode: product.productCode,
    name: product.name,
    description: listing.description,
    supplierName: product.supplierName ?? "",
    supplierId: product.supplierId ? String(product.supplierId) : "",
    region: listing.region,
    priceFrom: listing.priceFrom,
    currency: listing.currency,
    imageUrl: listing.heroImageUrl,
    productUrl: null,
    raw: product as unknown as Record<string, unknown>,
  };
}

export type RezdyAgentManualInquiry = {
  id: string;
  status: "OPEN" | "OPERATOR_NOTIFIED" | "CLOSED";
  productExternalId: string | null;
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
  travellerName: string | null;
  travellerEmail: string | null;
  travellerPhone: string | null;
  travellerMessage: string;
  createdAt: string;
};

/**
 * A Rezdy-Agent-synced operator's own manual-inquiry history (see OperatorListing.externalProductId's
 * schema comment for why this - not a ledger - is what these operators actually have today). Same
 * shared-secret pattern as fetchRezdyAgentMarketplaceProducts above; empty input returns no rows
 * without a network call, matching Kai's own fail-closed behaviour for an empty id list.
 */
export async function fetchRezdyAgentManualInquiries(
  externalProductIds: string[],
  env: RezdyAgentSyncEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RezdyAgentManualInquiry[]> {
  if (externalProductIds.length === 0) {
    return [];
  }

  const token = env.REZDY_AGENT_SYNC_TOKEN;
  if (!token) {
    throw new Error("REZDY_AGENT_SYNC_TOKEN is not configured.");
  }
  const baseUrl = (env.KAI_CORE_BASE_URL ?? "http://127.0.0.1:3107").replace(/\/$/, "");
  const params = new URLSearchParams({ productExternalIds: externalProductIds.join(",") });

  const response = await fetchImpl(`${baseUrl}/api/internal/rezdy-agent/manual-inquiries?${params.toString()}`, {
    headers: { "x-kai-internal-token": token },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kai manual-inquiries request failed with status ${response.status}.`);
  }

  const body = (await response.json()) as { inquiries?: unknown };
  return Array.isArray(body.inquiries) ? (body.inquiries as RezdyAgentManualInquiry[]) : [];
}

async function buildUniqueListingSlug(title: string) {
  const base = normalizeSlug(title) || "operator";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.operatorListing.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) {
      return slug;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Finds or auto-creates the BluePassAccount + OperatorProfile for a Rezdy-connected supplier who has
 * never signed up for BluePass directly. **Placeholder account**: synthetic email the real operator
 * doesn't know, unusable random passwordHash - they can't log in yet. This is a deliberate,
 * user-approved trade-off (2026-08-06): publish the listing immediately rather than wait for a
 * manual claim, at the cost of the real business not yet having a way to access the account BluePass
 * created for them. Bridging that gap (a real claim flow for these placeholder profiles) is an open
 * follow-up, not solved here - flag it, don't silently pretend it's handled.
 *
 * Dedupe key is rezdySupplierId, not kaiTenantSlug - a Rezdy marketplace supplier has no Kai
 * Tenant/booking flow of its own (that's a separate concept, used only by tenants like Boattime that
 * actually have bookings flowing through Kai).
 *
 * Returns `created` alongside the profile because the caller's own counter can no longer be derived
 * from a rezdySupplierId lookup - the name fallback below resolves profiles that have no supplier id
 * yet, and counting those as "created" would overstate every sync run.
 */
async function findOrCreateOperatorProfileForSupplier(product: RezdyMarketplaceProduct) {
  const existing = await prisma.operatorProfile.findUnique({ where: { rezdySupplierId: product.supplierId } });
  if (existing) {
    return { profile: existing, created: false };
  }

  /**
   * An operator onboarded by hand through the admin console (lib/services/admin/operator-onboarding.ts)
   * has a real companyName and real payout details but no rezdySupplierId - nobody knew it at the time
   * of the call. Without this fallback, the first sync that sees their Rezdy products builds a second
   * BluePassAccount + OperatorProfile for the same business, and the placeholder duplicate is the one
   * the listings hang off while the payout details sit on the profile nobody is looking at.
   *
   * Restricted to `rezdySupplierId: null` so this can never steal a supplier id from a profile that
   * already has a different one - only unclaimed profiles are eligible to be backfilled.
   */
  const supplierName = product.supplierName?.trim();
  if (supplierName) {
    /* Two candidates means the name does not identify anyone. Picking the older one would attach a
       real operator's listings - and eventually their payouts - to whichever row happened to be
       created first, silently and with nothing on screen to show it happened. A placeholder
       duplicate is the worse-looking outcome and the safer one: it is visible, and it is what
       already happens today. Only an unambiguous single match is backfilled. */
    const candidates = await prisma.operatorProfile.findMany({
      where: {
        rezdySupplierId: null,
        companyName: { equals: supplierName, mode: "insensitive" },
      },
      orderBy: { createdAt: "asc" },
      take: 2,
    });

    if (candidates.length === 1) {
      const backfilled = await prisma.operatorProfile.update({
        where: { id: candidates[0].id },
        data: { rezdySupplierId: product.supplierId },
      });

      return { profile: backfilled, created: false };
    }
  }

  const account = await prisma.bluePassAccount.create({
    data: {
      email: `rezdy+${product.supplierId}@ops.bluepass.co`,
      passwordHash: randomBytes(32).toString("hex"),
      displayName: product.supplierName || null,
      roles: ["OPERATOR"],
    },
  });

  const profile = await prisma.operatorProfile.create({
    data: {
      accountId: account.id,
      rezdySupplierId: product.supplierId,
      companyName: product.supplierName || null,
      status: "LIVE",
      country: "AU",
      notes: `Auto-created by the Rezdy Agent API Discover sync on ${new Date().toISOString().slice(0, 10)}.`,
    },
  });

  return { profile, created: true };
}

// Rezdy's marketplace product listing has no category concept in the mapping Kai exposes - default
// to a generic bucket until a human corrects it via the normal listing-edit flow (the same one
// operator-listing-service.ts's createDraftListing/updateDraftListing already provide).
const DEFAULT_REZDY_LISTING_CATEGORY = "Tour";

async function upsertListingForProduct(operatorProfileId: string, product: RezdyMarketplaceProduct) {
  // By product code first: titles change, codes do not. By title only for rows made
  // before codes were stored.
  const existing =
    (await prisma.operatorListing.findFirst({ where: { channel: "REZDY", externalProductId: product.productCode } }))
    ?? (await prisma.operatorListing.findFirst({ where: { operatorProfileId, title: product.name } }));
  // The full record makes the trip bookable through the agent API (see channels/rezdy).
  const raw = product.raw && typeof product.raw.productCode === "string" ? (product.raw as unknown as RezdyProduct) : null;
  const channel = raw
    ? {
        channel: "REZDY" as const,
        channelData: { product: raw, pickups: [] } as unknown as Prisma.InputJsonValue,
        channelSyncedAt: new Date(),
        channelIssue: productIssue(raw),
        durationMinutes: productToListing(raw).durationMinutes,
        meetingPoint: productToListing(raw).meetingPoint,
        confirmationNote: productToListing(raw).confirmationNote,
      }
    : { channel: "REZDY" as const };

  const data = {
    category: DEFAULT_REZDY_LISTING_CATEGORY,
    region: product.region || "Australia",
    description: product.description || product.name,
    heroImageUrl: product.imageUrl,
    priceSignal: product.priceFrom != null ? `From ${product.currency} ${product.priceFrom}` : null,
    // Real number backing priceSignal's display string - see the schema field's own comment for why
    // this exists separately (the Discover page needs a real number, priceSignal is free text).
    priceFrom: product.priceFrom,
    currency: product.currency || "AUD",
    // Kai-side join key for this operator's manual-inquiry history - see the schema field's own
    // comment. Kept in sync on every run, same as everything else in this object, since a product's
    // code never changes once assigned in Rezdy.
    externalProductId: product.productCode,
    ...channel,
  };

  if (existing) {
    return prisma.operatorListing.update({
      where: { id: existing.id },
      data,
    });
  }

  const slug = await buildUniqueListingSlug(product.name);

  return prisma.operatorListing.create({
    data: {
      operatorProfileId,
      slug,
      title: product.name,
      status: "LIVE",
      publishedAt: new Date(),
      ...data,
    },
  });
}

export type RezdyAgentSyncResult = {
  productsSeen: number;
  operatorsCreated: number;
  listingsCreated: number;
  listingsUpdated: number;
};

/** The pure-ish orchestration step: given already-fetched products, upsert accounts/profiles/listings. */
export async function syncRezdyAgentMarketplaceProducts(
  products: RezdyMarketplaceProduct[],
): Promise<RezdyAgentSyncResult> {
  const result: RezdyAgentSyncResult = { productsSeen: 0, operatorsCreated: 0, listingsCreated: 0, listingsUpdated: 0 };

  for (const product of products) {
    if (!product.supplierId || !product.name) {
      continue;
    }
    result.productsSeen += 1;

    const { profile, created } = await findOrCreateOperatorProfileForSupplier(product);
    if (created) {
      result.operatorsCreated += 1;
    }

    const listingBefore =
      (await prisma.operatorListing.findFirst({ where: { channel: "REZDY", externalProductId: product.productCode }, select: { id: true } }))
      ?? (await prisma.operatorListing.findFirst({ where: { operatorProfileId: profile.id, title: product.name }, select: { id: true } }));
    await upsertListingForProduct(profile.id, product);
    if (listingBefore) {
      result.listingsUpdated += 1;
    } else {
      result.listingsCreated += 1;
    }
  }

  return result;
}

/** The full live pipeline: fetch from Kai, then sync. Thin - the cron route calls this directly. */
export async function runRezdyAgentDiscoverSync(
  env: RezdyAgentSyncEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RezdyAgentSyncResult> {
  const products = await fetchRezdyAgentMarketplaceProducts(env, fetchImpl);
  return syncRezdyAgentMarketplaceProducts(products);
}
