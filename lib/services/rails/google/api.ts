import type { BusyInterval } from "@/lib/services/operators/listing-availability";

/**
 * Google Calendar, reduced to the handful of calls the booking CMS makes. Plain
 * fetch against the REST API rather than the googleapis package: a handful of calls
 * do not justify a dependency that size, and a port this small is easy to fake.
 *
 * Scopes are the narrowest Google offers for each job:
 * - calendar.app.created: make the "Bluepass bookings" calendar and manage only the
 *   events in it. Bluepass can never see or touch the operator's other calendars.
 * - calendar.calendarlist.readonly: list their calendars by name, so they can pick
 *   the one whose busy times should close departures.
 * - calendar.freebusy: read when they are busy. Never what the event is.
 * - openid email: show which Google account is connected.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function googleConfig(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const site = (env.NEXT_PUBLIC_SITE_URL || env.BLUEPASS_APP_URL || "https://bluepass.co").replace(/\/$/, "");
  return { clientId, clientSecret, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${site}/api/google/oauth/callback` };
}

/** A failure Google reported. `needsReconnect` separates "the operator must act" from "try again later". */
export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string | null) {
    super(message);
    this.name = "GoogleApiError";
  }

  get needsReconnect() {
    return (
      this.status === 401 ||
      this.reason === "invalid_grant" ||
      this.reason === "insufficientPermissions" ||
      this.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
    );
  }
}

export type GoogleCalendarSummary = { id: string; summary: string; primary: boolean; accessRole: string };

export type GoogleEventBody = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status: "confirmed";
  source?: { title: string; url: string };
  extendedProperties?: { private: Record<string, string> };
};

export interface GoogleCalendarApi {
  /** A fresh access token for a stored refresh token. */
  accessToken(refreshToken: string): Promise<string>;
  /** Withdraws Bluepass's access, as if the operator had removed it in their Google account. */
  revoke(refreshToken: string): Promise<void>;
  createCalendar(token: string, input: { summary: string; description: string; timeZone: string }): Promise<string>;
  calendarExists(token: string, calendarId: string): Promise<boolean>;
  deleteCalendar(token: string, calendarId: string): Promise<void>;
  listCalendars(token: string): Promise<GoogleCalendarSummary[]>;
  /** Creates the event with this id, or replaces it if it exists (including one deleted earlier). */
  putEvent(token: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<void>;
  /** Removes the event; one that is already gone counts as removed. */
  deleteEvent(token: string, calendarId: string, eventId: string): Promise<void>;
  freeBusy(
    token: string,
    calendarIds: string[],
    timeMin: Date,
    timeMax: Date,
  ): Promise<Record<string, { busy: BusyInterval[]; error: string | null }>>;
}

/**
 * Google's addresses. In development only, GOOGLE_API_ORIGIN_OVERRIDE points all four
 * at a local stand-in, so the whole connect-and-sync flow can be exercised end to end
 * without a Google Cloud project. Production always talks to Google.
 */
function endpoints() {
  const override = process.env.NODE_ENV !== "production" ? process.env.GOOGLE_API_ORIGIN_OVERRIDE?.trim().replace(/\/$/, "") : "";
  return override
    ? { calendar: `${override}/calendar/v3`, token: `${override}/token`, authorize: `${override}/o/oauth2/v2/auth`, revoke: `${override}/revoke` }
    : {
        calendar: "https://www.googleapis.com/calendar/v3",
        token: "https://oauth2.googleapis.com/token",
        authorize: "https://accounts.google.com/o/oauth2/v2/auth",
        revoke: "https://oauth2.googleapis.com/revoke",
      };
}

async function failure(response: Response, what: string): Promise<GoogleApiError> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string | { message?: string; status?: string; errors?: { reason?: string }[] }; error_description?: string }
    | null;
  if (body && typeof body.error === "string") {
    return new GoogleApiError(`${what}: ${body.error_description ?? body.error}`, response.status, body.error);
  }
  const error = body && typeof body.error === "object" ? body.error : undefined;
  const reason = error?.errors?.[0]?.reason ?? error?.status ?? null;
  return new GoogleApiError(`${what}: ${error?.message ?? response.statusText}`, response.status, reason);
}

async function call(token: string, method: string, path: string, what: string, body?: unknown) {
  const response = await fetch(`${endpoints().calendar}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  return { response, fail: () => failure(response, what) };
}

export function googleCalendarApi(config: GoogleConfig | null = googleConfig()): GoogleCalendarApi | null {
  if (!config) return null;

  return {
    async accessToken(refreshToken) {
      const response = await fetch(endpoints().token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw await failure(response, "Refreshing the Google token failed");
      const data = (await response.json()) as { access_token?: string };
      if (!data.access_token) throw new GoogleApiError("Google returned no access token", 500, null);
      return data.access_token;
    },

    async revoke(refreshToken) {
      await revokeToken(refreshToken);
    },

    async createCalendar(token, input) {
      const { response, fail } = await call(token, "POST", "/calendars", "Creating the calendar failed", input);
      if (!response.ok) throw await fail();
      return ((await response.json()) as { id: string }).id;
    },

    async calendarExists(token, calendarId) {
      const { response, fail } = await call(token, "GET", `/calendars/${encodeURIComponent(calendarId)}`, "Reading the calendar failed");
      if (response.status === 404 || response.status === 410) return false;
      if (!response.ok) throw await fail();
      return true;
    },

    async deleteCalendar(token, calendarId) {
      const { response, fail } = await call(token, "DELETE", `/calendars/${encodeURIComponent(calendarId)}`, "Removing the calendar failed");
      if (!response.ok && response.status !== 404 && response.status !== 410) throw await fail();
    },

    async listCalendars(token) {
      const out: GoogleCalendarSummary[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const query = new URLSearchParams({ minAccessRole: "reader", maxResults: "250", ...(pageToken ? { pageToken } : {}) });
        const { response, fail } = await call(token, "GET", `/users/me/calendarList?${query}`, "Listing calendars failed");
        if (!response.ok) throw await fail();
        const data = (await response.json()) as {
          items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }[];
          nextPageToken?: string;
        };
        for (const c of data.items ?? []) {
          out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary), accessRole: c.accessRole ?? "reader" });
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },

    async putEvent(token, calendarId, eventId, body) {
      const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
      // Update first: an event deleted earlier still exists in a cancelled state, and an
      // update brings it back where an insert would collide with its id.
      const updated = await call(token, "PUT", `${base}/${eventId}`, "Updating the event failed", body);
      if (updated.response.ok) return;
      if (updated.response.status !== 404) throw await updated.fail();
      const inserted = await call(token, "POST", base, "Adding the event failed", { ...body, id: eventId });
      if (inserted.response.ok) return;
      if (inserted.response.status === 409) {
        const retried = await call(token, "PUT", `${base}/${eventId}`, "Updating the event failed", body);
        if (retried.response.ok) return;
        throw await retried.fail();
      }
      throw await inserted.fail();
    },

    async deleteEvent(token, calendarId, eventId) {
      const { response, fail } = await call(
        token, "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, "Removing the event failed",
      );
      if (!response.ok && response.status !== 404 && response.status !== 410) throw await fail();
    },

    async freeBusy(token, calendarIds, timeMin, timeMax) {
      const { response, fail } = await call(token, "POST", "/freeBusy", "Reading busy times failed", {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      });
      if (!response.ok) throw await fail();
      const data = (await response.json()) as {
        calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }>;
      };
      const out: Record<string, { busy: BusyInterval[]; error: string | null }> = {};
      for (const id of calendarIds) {
        const entry = data.calendars?.[id];
        out[id] = {
          busy: (entry?.busy ?? []).map((b) => ({ startsAt: new Date(b.start), endsAt: new Date(b.end) })),
          error: entry?.errors?.[0]?.reason ?? (entry ? null : "notFound"),
        };
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Connecting and disconnecting
// ---------------------------------------------------------------------------

/** Where the operator is sent to grant access. `prompt=consent` makes Google return a refresh token every time. */
export function authorizeUrl(config: GoogleConfig, state: string, loginHint?: string) {
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${endpoints().authorize}?${query}`;
}

export type GrantedTokens = { refreshToken: string; accessToken: string; scopes: string[]; email: string | null };

export async function exchangeCode(config: GoogleConfig, code: string): Promise<GrantedTokens> {
  const response = await fetch(endpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await failure(response, "Google did not accept the sign-in");
  const data = (await response.json()) as { access_token: string; refresh_token?: string; scope?: string; id_token?: string };
  if (!data.refresh_token) {
    throw new GoogleApiError("Google did not grant offline access. Try connecting again.", 400, "no_refresh_token");
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    scopes: (data.scope ?? "").split(" ").filter(Boolean),
    email: emailFromIdToken(data.id_token),
  };
}

/**
 * The account's email from the ID token. Read without verifying the signature, which
 * is safe only because the token came straight from Google's token endpoint over TLS
 * in the call above, never from the browser.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

export async function revokeToken(token: string) {
  await fetch(endpoints().revoke, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** The scopes this build needs, missing from what the operator granted. Google lets people untick boxes. */
export function missingScopes(granted: string[]): string[] {
  const needed = GOOGLE_SCOPES.filter((s) => s.startsWith("https://"));
  return needed.filter((s) => !granted.includes(s));
}
