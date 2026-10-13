import {
  buildKaiCoreHeaders,
  fetchKaiCoreWithRetry,
  resolveKaiCoreConfig,
  type KaiCoreClientEnv,
} from "@/lib/services/kai-core/client";

type FetchLike = typeof fetch;

/**
 * The operator's own trips and bookings on Kai's native booking system, through Kai's admin API.
 *
 * Every call here is made by this server on the operator's behalf, with BluePass's admin token. The
 * tenant slug always comes from the signed-in operator's own profile, never from the browser, so an
 * operator cannot point any of this at someone else's trips.
 */

export type NativeTicket = {
  label: string;
  priceCents: number;
  kind: "TICKET" | "EXTRA";
  sortOrder?: number;
  active?: boolean;
};

export type NativeSchedule = {
  daysOfWeek: number[];
  localTime: string;
  seats: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
};

export type NativeBlackout = { fromDate: string; toDate: string; reason?: string | null };

export type NativeTripInput = {
  title: string;
  description: string;
  durationMinutes: number;
  meetingPoint: string;
  photoUrls: string[];
  currency: string;
  timeZone: string;
  tickets: NativeTicket[];
  schedules: NativeSchedule[];
  blackouts: NativeBlackout[];
};

export type NativeTrip = NativeTripInput & {
  id: string;
  status: "DRAFT" | "PUBLISHED";
  tickets: Required<NativeTicket>[];
  lowestTicketCents: number | null;
  updatedAt: string;
};

export type NativeBooking = {
  id: string;
  status: "HELD" | "WAITING_OPERATOR" | "CONFIRMED" | "DECLINED" | "CANCELLED" | "EXPIRED";
  tripId: string;
  tripTitle: string;
  localDate: string;
  localTime: string;
  seats: number;
  totalCents: number;
  currency: string;
  travellerName: string;
  travellerEmail: string;
  travellerPhone: string | null;
  tickets: { optionLabel: string; quantity: number }[];
  extras: { optionLabel: string; quantity: number }[];
  paymentAttemptId: string | null;
  operatorDeadlineAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type NativeDecisionOutcome = "CONFIRMED" | "REFUNDED" | "REFUND_FAILED" | "NOT_WAITING";

/** What went wrong, in words an operator can act on. `issues` lists every field problem at once. */
export class KaiNativeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

function adminConfig(env: KaiCoreClientEnv) {
  const adminToken = env.KAI_CORE_ADMIN_TOKEN?.trim();

  if (!adminToken) {
    throw new KaiNativeError("Bookings are not connected yet. Try again later.", "NOT_CONFIGURED", 503);
  }

  const config = resolveKaiCoreConfig(env);
  return { config, headers: { ...buildKaiCoreHeaders(config), authorization: `Bearer ${adminToken}` } };
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
  env: KaiCoreClientEnv,
  fetchImpl: FetchLike,
): Promise<T> {
  const { config, headers } = adminConfig(env);
  const request: RequestInit = {
    method: init.method,
    headers,
    cache: "no-store",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  };
  const url = `${config.baseUrl}${path}`;

  /* Only reads are retried. A repeated write could create a second trip or answer a booking twice. */
  let response: Response;
  try {
    response = init.method === "GET" ? await fetchKaiCoreWithRetry(fetchImpl, url, request) : await fetchImpl(url, request);
  } catch {
    throw new KaiNativeError("Could not reach the booking system. Nothing was changed. Try again in a minute.", "UNREACHABLE", 502);
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string; issues?: string[] } })
    | null;

  if (!response.ok) {
    const error = data?.error;
    throw new KaiNativeError(
      error?.message ?? "The booking system could not do that. Nothing was changed.",
      error?.code ?? "FAILED",
      response.status,
      Array.isArray(error?.issues) ? error.issues : [],
    );
  }

  return data as T;
}

const base = (tenantSlug: string) => `/api/admin/${encodeURIComponent(tenantSlug)}`;

export async function ensureKaiNativeTenant(
  input: { externalOperatorId: string; name: string; adminWhatsAppPhone?: string | null; goLive?: boolean },
  env: KaiCoreClientEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  const result = await call<{ tenant: { slug: string; name: string; enabledFeatures: string[]; created: boolean } }>(
    "/api/admin/native-tenants",
    { method: "POST", body: input },
    env,
    fetchImpl,
  );
  return result.tenant;
}

export async function listKaiNativeTrips(tenantSlug: string, env: KaiCoreClientEnv = process.env, fetchImpl: FetchLike = fetch) {
  return (await call<{ trips: NativeTrip[] }>(`${base(tenantSlug)}/native-trips`, { method: "GET" }, env, fetchImpl)).trips;
}

export async function getKaiNativeTrip(tenantSlug: string, tripId: string, env: KaiCoreClientEnv = process.env, fetchImpl: FetchLike = fetch) {
  return (await call<{ trip: NativeTrip }>(`${base(tenantSlug)}/native-trips/${encodeURIComponent(tripId)}`, { method: "GET" }, env, fetchImpl)).trip;
}

export async function createKaiNativeTrip(
  tenantSlug: string,
  input: NativeTripInput,
  env: KaiCoreClientEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  return (await call<{ trip: NativeTrip }>(`${base(tenantSlug)}/native-trips`, { method: "POST", body: input }, env, fetchImpl)).trip;
}

export async function updateKaiNativeTrip(
  tenantSlug: string,
  tripId: string,
  input: NativeTripInput,
  env: KaiCoreClientEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  return (
    await call<{ trip: NativeTrip }>(`${base(tenantSlug)}/native-trips/${encodeURIComponent(tripId)}`, { method: "PUT", body: input }, env, fetchImpl)
  ).trip;
}

export async function setKaiNativeTripPublished(
  tenantSlug: string,
  tripId: string,
  published: boolean,
  env: KaiCoreClientEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  return (
    await call<{ trip: NativeTrip }>(
      `${base(tenantSlug)}/native-trips/${encodeURIComponent(tripId)}/publish`,
      { method: "POST", body: { published } },
      env,
      fetchImpl,
    )
  ).trip;
}

export async function deleteKaiNativeTrip(tenantSlug: string, tripId: string, env: KaiCoreClientEnv = process.env, fetchImpl: FetchLike = fetch) {
  await call<{ ok: true }>(`${base(tenantSlug)}/native-trips/${encodeURIComponent(tripId)}`, { method: "DELETE" }, env, fetchImpl);
}

export async function listKaiNativeBookings(
  tenantSlug: string,
  scope: "pending" | "all" = "all",
  env: KaiCoreClientEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  const query = scope === "pending" ? "?scope=pending" : "";
  return (await call<{ bookings: NativeBooking[] }>(`${base(tenantSlug)}/native-bookings${query}`, { method: "GET" }, env, fetchImpl)).bookings;
}

/** Accept confirms the booking; decline releases the seats and refunds the traveller in full. */
export async function decideKaiNativeBooking(
  tenantSlug: string,
  attemptId: string,
  decision: "ACCEPT" | "DECLINE",
  note?: string,
  env: KaiCoreClientEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  /* NOT_WAITING comes back as a 409 with a normal body: someone else answered first. Surfaced as a
     result, not an exception, because it is the expected outcome of a repeated click. */
  const { config, headers } = adminConfig(env);
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${base(tenantSlug)}/native-bookings/${encodeURIComponent(attemptId)}/decision`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
    });
  } catch {
    throw new KaiNativeError("Could not reach the booking system. Nothing was changed. Try again in a minute.", "UNREACHABLE", 502);
  }

  const data = (await response.json().catch(() => null)) as { outcome?: NativeDecisionOutcome; error?: { message?: string; code?: string } } | null;

  if (data?.outcome) {
    return { outcome: data.outcome };
  }

  throw new KaiNativeError(data?.error?.message ?? "The booking system could not record that answer.", data?.error?.code ?? "FAILED", response.status);
}
