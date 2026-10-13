/**
 * Rezdy's API for agents, as Bluepass uses it: one agent account reads every operator
 * who shares trips with Bluepass, and books them.
 *
 * Shapes follow Rezdy's published OpenAPI spec (developers.rezdy.com/rezdyapi/index-agent.html),
 * and were checked against real responses from Rezdy's staging demo account. Only the
 * fields Bluepass reads are typed; everything else rides along untouched.
 *
 * Money in Rezdy is decimal dollars ("250.0"). It becomes cents at the edge of this
 * module and nowhere else.
 */

export type RezdyPaymentType = "PAYOUTS" | "FULL_AGENT" | "DOWNPAYMENT" | "FULL_SUPPLIER" | "NONE";
export type RezdyConfirmMode = "MANUAL" | "AUTOCONFIRM" | "MANUAL_THEN_AUTO" | "AUTO_THEN_MANUAL";
export type RezdyBookingMode = "NO_DATE" | "DATE_ENQUIRY" | "INVENTORY";
export type RezdyOrderStatus =
  | "PROCESSING" | "NEW" | "ON_HOLD" | "PENDING_SUPPLIER" | "PENDING_CUSTOMER" | "CONFIRMED" | "CANCELLED" | "ABANDONED_CART";

export type RezdyPriceOption = {
  id?: number;
  label: string;
  price: number;
  seatsUsed?: number;
  minQuantity?: number;
  maxQuantity?: number;
  priceGroupType?: "EACH" | "TOTAL";
  productCode?: string;
};

export type RezdyBookingField = {
  label: string;
  value?: string;
  requiredPerParticipant?: boolean;
  requiredPerBooking?: boolean;
  visiblePerParticipant?: boolean;
  visiblePerBooking?: boolean;
  listOptions?: string;
  fieldType?: "String" | "List" | "Boolean" | "Phone" | "Date" | "Hidden";
};

export type RezdyImage = { itemUrl?: string; largeSizeUrl?: string; mediumSizeUrl?: string; thumbnailUrl?: string; isPrimary?: boolean };

export type RezdyAddress = {
  addressLine?: string;
  addressLine2?: string;
  postCode?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
};

export type RezdyTax = {
  label?: string;
  taxFeeType?: "TAX" | "FEE";
  taxType?: "PERCENT" | "FIXED_PER_QUANTITY" | "FIXED_PER_ORDER" | "FIXED_PER_DURATION";
  taxPercent?: number;
  taxAmount?: number;
  priceInclusive?: boolean;
  compound?: boolean;
};

export type RezdyExtra = { name: string; description?: string; price: number; extraPriceType?: "ANY" | "FIXED" | "QUANTITY"; quantity?: number };

export type RezdyProduct = {
  productCode: string;
  name: string;
  productType?: string;
  shortDescription?: string;
  description?: string;
  supplierId?: number;
  supplierAlias?: string;
  supplierName?: string;
  timezone?: string;
  advertisedPrice?: number;
  priceOptions?: RezdyPriceOption[];
  currency?: string;
  unitLabel?: string;
  unitLabelPlural?: string;
  quantityRequiredMin?: number;
  quantityRequiredMax?: number;
  images?: RezdyImage[];
  bookingMode?: RezdyBookingMode;
  charter?: boolean;
  terms?: string;
  bookingFields?: RezdyBookingField[];
  extras?: RezdyExtra[];
  confirmMode?: RezdyConfirmMode;
  confirmModeMinParticipants?: number;
  agentPaymentType?: RezdyPaymentType;
  maxCommissionPercent?: number;
  maxCommissionNetRate?: number;
  minimumNoticeMinutes?: number;
  durationMinutes?: number;
  dateUpdated?: string;
  pickupId?: number;
  locationAddress?: RezdyAddress;
  additionalInformation?: string;
  /** Taxes and fees, some inside the price and some on top of it. */
  taxes?: RezdyTax[];
  isApiBookingSupported?: boolean;
  apiBookingSupported?: boolean;
  waitListingEnabled?: boolean;
};

export type RezdySession = {
  id?: number;
  productCode: string;
  startTime: string;
  endTime?: string;
  startTimeLocal: string;
  endTimeLocal?: string;
  allDay?: boolean;
  seats?: number;
  seatsAvailable: number;
  priceOptions?: RezdyPriceOption[];
};

export type RezdyPickup = {
  locationName: string;
  address?: string;
  minutesPrior?: number;
  additionalInstructions?: string;
};

export type RezdyCompany = {
  alias: string;
  companyName: string;
  currency?: string;
  timezone?: string;
  website?: string;
  phone?: string;
};

export type RezdyQuantity = { optionLabel: string; value: number; optionPrice?: number };
export type RezdyFieldValue = { label: string; value: string };

export type RezdyBookingItem = {
  productCode: string;
  productName?: string;
  startTime?: string;
  startTimeLocal?: string;
  endTimeLocal?: string;
  quantities: RezdyQuantity[];
  totalQuantity?: number;
  amount?: number;
  participants?: { fields: RezdyFieldValue[] }[];
  extras?: { name: string; quantity: number }[];
  pickupLocation?: { locationName?: string; pickupInstructions?: string; pickupTime?: string };
  subtotal?: number;
};

export type RezdyPayment = {
  type: string;
  amount: number;
  currency?: string;
  date?: string;
  label?: string;
  recipient?: "SUPPLIER" | "RESELLER" | "REZDY";
};

export type RezdyBookingRequest = {
  status?: RezdyOrderStatus;
  customer: { firstName: string; lastName: string; email?: string; phone?: string };
  items: RezdyBookingItem[];
  fields?: RezdyFieldValue[];
  payments?: RezdyPayment[];
  creditCard?: { cardToken: string };
  resellerReference?: string;
  resellerComments?: string;
  comments?: string;
  sendNotifications?: boolean;
};

export type RezdyBooking = {
  orderNumber?: string;
  status?: RezdyOrderStatus;
  items?: RezdyBookingItem[];
  totalAmount?: number;
  totalCurrency?: string;
  totalPaid?: number;
  totalDue?: number;
  commission?: number;
  payments?: RezdyPayment[];
  resellerReference?: string;
  dateUpdated?: string;
  supplierAlias?: string;
  supplierId?: number;
  customer?: { firstName?: string; lastName?: string; email?: string; phone?: string };
  [key: string]: unknown;
};

/** A refusal from Rezdy, with its code kept so callers can tell a full session from a declined card. */
export class RezdyError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
    /** Worth trying again: rate limited, Rezdy down, or the network dropped. */
    readonly transient: boolean,
    readonly detail?: { seatsAvailable?: number; fields?: unknown },
  ) {
    super(message);
    this.name = "RezdyError";
  }
}

/** The port the rest of Bluepass talks to. Tests and the local mock implement it too. */
export interface RezdyApi {
  marketplaceProducts(query: {
    supplierAlias?: string;
    supplierId?: string | number;
    updatedSince?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<RezdyProduct[]>;
  product(productCode: string): Promise<RezdyProduct | null>;
  pickups(productCode: string): Promise<RezdyPickup[]>;
  company(alias: string): Promise<RezdyCompany | null>;
  availability(query: { productCode: string; startTimeLocal: string; endTimeLocal: string; minAvailability?: number }): Promise<RezdySession[]>;
  quote(booking: RezdyBookingRequest): Promise<RezdyBooking>;
  createBooking(booking: RezdyBookingRequest): Promise<RezdyBooking>;
  updateBooking(orderNumber: string, booking: RezdyBooking): Promise<RezdyBooking>;
  cancelBooking(orderNumber: string, options?: { sendNotifications?: boolean }): Promise<RezdyBooking | null>;
  getBooking(orderNumber: string): Promise<RezdyBooking | null>;
  searchBookings(query: { updatedSince?: string; resellerReference?: string; limit?: number; offset?: number }): Promise<RezdyBooking[]>;
}

// Rezdy's own Stripe publishable keys, published in its agent API guide for exactly this:
// an agent tokenises the traveller's card in the browser on Rezdy's Stripe account, and
// Rezdy charges it when the booking is made (automated payments).
const REZDY_STRIPE_PK_PRODUCTION =
  "pk_live_51H4gSPHO6p5n6bFnuGRLb84FCiptIUAwmgYaBubvp5A09HujFx54ExvLkXOufEcqrHsaCWvnmZfO33efkIFVbpIv00PkoJDRDA";
const REZDY_STRIPE_PK_STAGING =
  "pk_test_51KW8A8ItvA6u4On8YM6AE95ytcqBr0LeRBEEFw4f5MDQPTDBWVt2TAWXhfynCn7NUVwaGc2eP431DNCkmfMaB0AF00firEVJ58";

export type RezdyConfig = {
  baseUrl: string;
  apiKey: string;
  environment: "production" | "staging" | "local";
  /** Rezdy's key, never Bluepass's: the card is tokenised on Rezdy's Stripe account. */
  stripePublishableKey: string;
  /** Secret in the webhook URL Rezdy posts order changes to. */
  webhookSecret: string | null;
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function rezdyConfig(env: Record<string, string | undefined> = process.env): RezdyConfig | null {
  const apiKey = env.REZDY_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (env.REZDY_API_URL?.trim() || "https://api.rezdy.com/v1").replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return null;
  }
  const local = LOCAL_HOSTS.has(host);
  // A local mock stands in for Rezdy in development only, never in production.
  if (local && env.NODE_ENV === "production") return null;
  const environment = local ? "local" : host.includes("rezdy-staging") ? "staging" : "production";
  return {
    baseUrl,
    apiKey,
    environment,
    stripePublishableKey:
      env.REZDY_STRIPE_PUBLISHABLE_KEY?.trim() || (environment === "production" ? REZDY_STRIPE_PK_PRODUCTION : REZDY_STRIPE_PK_STAGING),
    webhookSecret: env.REZDY_WEBHOOK_SECRET?.trim() || null,
  };
}

type FetchLike = typeof fetch;

/** One Rezdy page is at most 100 rows. */
const PAGE = 100;
/** A sanity bound on paging, not an expected size: 50 pages is 5,000 rows. */
const MAX_PAGES = 50;

export function liveRezdyApi(config: RezdyConfig, fetchImpl: FetchLike = fetch): RezdyApi {
  async function call<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
    body?: unknown,
    opts: { allowNotFound?: boolean } = {},
  ): Promise<T | null> {
    const url = new URL(`${config.baseUrl}${path}`);
    url.searchParams.set("apiKey", config.apiKey);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

    const controller = new AbortController();
    // Writes get longer: a booking with a card charge can take Rezdy several seconds.
    const timer = setTimeout(() => controller.abort(), method === "GET" ? 15_000 : 45_000);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      throw new RezdyError(
        error instanceof Error && error.name === "AbortError" ? "Rezdy took too long to answer." : "Rezdy could not be reached.",
        null, 0, true,
      );
    } finally {
      clearTimeout(timer);
    }

    // Rezdy signals its rate limit with 406 "Too Many Requests".
    if (response.status === 406 || response.status === 429) throw new RezdyError("Rezdy is busy. Try again in a minute.", "RATE_LIMIT", response.status, true);
    if (response.status === 404 && opts.allowNotFound) return null;

    const text = await response.text();
    let json: { requestStatus?: { success?: boolean; error?: { errorCode?: string; errorMessage?: string; seatsAvailable?: number; fields?: unknown } } } & Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new RezdyError(`Rezdy answered with something that was not JSON (status ${response.status}).`, null, response.status, response.status >= 500);
    }

    const status = json.requestStatus;
    if (!response.ok || status?.success === false) {
      const err = status?.error;
      if (opts.allowNotFound && (response.status === 404 || /not found/i.test(err?.errorMessage ?? ""))) return null;
      throw new RezdyError(
        err?.errorMessage || `Rezdy refused the request (status ${response.status}).`,
        err?.errorCode ?? null,
        response.status,
        response.status >= 500,
        { seatsAvailable: err?.seatsAvailable, fields: err?.fields },
      );
    }
    return json as T;
  }

  async function paged<T>(path: string, key: string, query: Record<string, string | number | boolean | undefined>, limit?: number) {
    const rows: T[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const size = Math.min(limit ?? PAGE, PAGE);
      const offset = (query.offset as number | undefined ?? 0) + page * size;
      const body = await call<Record<string, unknown>>("GET", path, { ...query, limit: size, offset });
      const batch = (body?.[key] as T[] | undefined) ?? [];
      rows.push(...batch);
      if (batch.length < size || (limit !== undefined && rows.length >= limit)) break;
    }
    return rows;
  }

  return {
    async marketplaceProducts(query) {
      const { limit, ...rest } = query;
      return paged<RezdyProduct>("/products/marketplace", "products", rest, limit);
    },
    async product(productCode) {
      const body = await call<{ product?: RezdyProduct }>("GET", `/products/${encodeURIComponent(productCode)}`, {}, undefined, { allowNotFound: true });
      return body?.product ?? null;
    },
    async pickups(productCode) {
      const body = await call<{ pickupLocations?: RezdyPickup[] }>("GET", `/products/${encodeURIComponent(productCode)}/pickups`, {}, undefined, { allowNotFound: true });
      return body?.pickupLocations ?? [];
    },
    async company(alias) {
      const body = await call<{ company?: RezdyCompany }>("GET", `/companies/alias/${encodeURIComponent(alias)}`, {}, undefined, { allowNotFound: true });
      return body?.company ?? null;
    },
    async availability(query) {
      return paged<RezdySession>("/availability", "sessions", query);
    },
    async quote(booking) {
      const body = await call<{ booking: RezdyBooking }>("POST", "/bookings/quote", {}, booking);
      return body!.booking;
    },
    async createBooking(booking) {
      const body = await call<{ booking: RezdyBooking }>("POST", "/bookings", {}, booking);
      return body!.booking;
    },
    async updateBooking(orderNumber, booking) {
      const body = await call<{ booking: RezdyBooking }>("PUT", `/bookings/${encodeURIComponent(orderNumber)}`, {}, booking);
      return body!.booking;
    },
    async cancelBooking(orderNumber, options) {
      const body = await call<{ booking?: RezdyBooking }>(
        "DELETE", `/bookings/${encodeURIComponent(orderNumber)}`,
        { sendNotifications: options?.sendNotifications ?? false }, undefined, { allowNotFound: true },
      );
      return body?.booking ?? null;
    },
    async getBooking(orderNumber) {
      const body = await call<{ booking?: RezdyBooking }>("GET", `/bookings/${encodeURIComponent(orderNumber)}`, {}, undefined, { allowNotFound: true });
      return body?.booking ?? null;
    },
    async searchBookings(query) {
      const { limit, ...rest } = query;
      return paged<RezdyBooking>("/bookings", "bookings", { ...rest, role: "RESELLER" }, limit);
    },
  };
}

let replacement: RezdyApi | null | undefined;

/** Tests swap the live client for the in-memory simulator; undefined puts it back. */
export function replaceRezdyApiForTests(api: RezdyApi | null | undefined) {
  replacement = api;
}

/** The live client, or null when no Rezdy agent key is configured. */
export function rezdyApi(env: Record<string, string | undefined> = process.env): RezdyApi | null {
  if (replacement !== undefined) return replacement;
  const config = rezdyConfig(env);
  return config ? liveRezdyApi(config) : null;
}
