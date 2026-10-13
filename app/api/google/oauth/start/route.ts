import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import { railsAccess } from "@/lib/services/rails/access";
import { authorizeUrl, googleConfig } from "@/lib/services/rails/google/api";
import { siteUrl } from "@/lib/services/rails/links";

export const dynamic = "force-dynamic";

const GOOGLE_STATE_COOKIE = "bp_google_state";

/**
 * GET /api/google/oauth/start
 *
 * Sends a signed-in operator to Google to connect their calendar. The state value
 * goes to Google and into a short-lived cookie bound to this operator; the callback
 * only accepts a reply carrying both, so a link someone else started cannot attach
 * their Google account to this operator, or this operator's to theirs.
 */
export async function GET() {
  const back = (q: string) => NextResponse.redirect(`${siteUrl()}/operator/connections?google=${q}`);
  const access = await currentOperatorAccess();
  if (!access.ok) return NextResponse.redirect(`${siteUrl()}/login?next=/operator/connections`);
  if (!(await railsAccess(access.profile)).enabled) return back("unavailable");
  const config = googleConfig();
  if (!config) return back("not-configured");

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(authorizeUrl(config, state, access.account.email));
  response.cookies.set(GOOGLE_STATE_COOKIE, `${state}.${access.profile.id}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google/oauth",
    maxAge: 600,
  });
  return response;
}
