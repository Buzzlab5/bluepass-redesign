import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import { syncCalendarSoon } from "@/lib/services/rails/background";
import { exchangeCode, googleCalendarApi, googleConfig, missingScopes } from "@/lib/services/rails/google/api";
import { saveConnection } from "@/lib/services/rails/google/sync";
import { siteUrl } from "@/lib/services/rails/links";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "bp_google_state";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * GET /api/google/oauth/callback
 *
 * Google sends the operator back here. Accepted only with the state this operator's
 * own browser was given, while they are still signed in as that operator. A grant
 * missing a calendar permission (Google lets people untick boxes) is withdrawn
 * straight away rather than kept half-working.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const done = (q: string) => {
    const response = NextResponse.redirect(`${siteUrl()}/operator/connections?google=${q}`);
    response.cookies.set(STATE_COOKIE, "", { path: "/api/google/oauth", maxAge: 0 });
    return response;
  };

  if (params.get("error")) return done("cancelled");
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  const [expected, profileId] = (request.cookies.get(STATE_COOKIE)?.value ?? "").split(".");
  if (!state || !code || !expected || !profileId || !same(state, expected)) return done("expired");

  const access = await currentOperatorAccess();
  if (!access.ok || access.profile.id !== profileId) return done("expired");
  const config = googleConfig();
  if (!config) return done("not-configured");

  try {
    const granted = await exchangeCode(config, code);
    if (missingScopes(granted.scopes).length > 0) {
      await googleCalendarApi(config)?.revoke(granted.refreshToken);
      return done("missing-permissions");
    }
    await saveConnection({
      operatorProfileId: profileId,
      refreshToken: granted.refreshToken,
      googleEmail: granted.email ?? "your Google account",
      scopes: granted.scopes,
    });
    syncCalendarSoon(profileId);
    return done("connected");
  } catch (error) {
    console.warn("rails.google_connect_failed", { error: error instanceof Error ? error.message : String(error) });
    return done("failed");
  }
}
