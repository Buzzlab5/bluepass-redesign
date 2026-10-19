import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleInstantlyEvent, type InstantlyEvent } from "@/lib/services/outreach/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * POST /api/webhooks/instantly
 *
 * Registered by scripts/instantly-setup.ts for all events, with the header
 * "Authorization: Bearer <INSTANTLY_WEBHOOK_SECRET>" (Instantly does not sign deliveries).
 *
 * A failure answers 500 so Instantly retries: each event is recorded once under its own
 * key, so a retry that arrives after a partial success does nothing twice.
 */
export async function POST(request: Request) {
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(request.url).searchParams.get("key") ?? "";
  if (!secret || !sameSecret(given, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as InstantlyEvent | InstantlyEvent[] | null;
  if (!body) return NextResponse.json({ ok: true, ignored: "No body." });
  try {
    const results = [];
    for (const event of Array.isArray(body) ? body : [body]) results.push(await handleInstantlyEvent(event));
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("instantly.webhook_failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }
}
