import { NextResponse, type NextRequest } from "next/server";
import { createTravellerSession } from "@/lib/services/auth/session";
import { claimPreparedPage } from "@/lib/services/operators/prepared-claim";

/**
 * The "Claim and publish" button posts here as a plain form. Claiming signs the operator
 * in, and a page that redrew itself after that would show a spent link instead of moving
 * on, so the answer is always a full redirect: to their page once claimed, or back to the
 * review with the reason it did not work.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const back = (code: string) =>
    NextResponse.redirect(new URL(`/operator/claim/verify?token=${encodeURIComponent(token)}&error=${code}`, request.url), 303);
  if (!token) return back("invalid");

  const result = await claimPreparedPage({ token });
  if (!result.ok) return back(result.code);
  await createTravellerSession(result.accountId);
  return NextResponse.redirect(new URL("/operator/your-page?welcome=1", request.url), 303);
}
