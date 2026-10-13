import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { rezdyConfig, rezdyApi } from "@/lib/services/channels/rezdy/api";
import { reconcileRezdyOrderNumber } from "@/lib/services/channels/rezdy/booking";
import { railsPayments } from "@/lib/services/rails/payments";

export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * POST /api/channels/rezdy/webhook?key=<REZDY_WEBHOOK_SECRET>
 *
 * Set up once in Bluepass's own Rezdy agent account (Integrations, Webhooks) for
 * Updated Order and Cancelled Order. Rezdy does not sign webhooks, so the secret
 * travels in the URL, and the payload is only ever used to learn which order changed:
 * the order itself is read fresh from Rezdy before anything is done with it.
 *
 * Always answers 200 once the secret checks out. Rezdy suspends a webhook after 20
 * failures in a row, and the 15-minute reconciler catches anything this misses.
 */
export async function POST(request: Request) {
  const config = rezdyConfig();
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!config?.webhookSecret || !sameSecret(key, config.webhookSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const order = (body?.booking ?? body?.order ?? body) as { orderNumber?: unknown } | null;
  const orderNumber = typeof order?.orderNumber === "string" ? order.orderNumber : null;
  if (!orderNumber) return NextResponse.json({ ok: true, ignored: "No order number." });
  try {
    const outcome = await reconcileRezdyOrderNumber(orderNumber, rezdyApi(), railsPayments());
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    console.error("rezdy.webhook_failed", { orderNumber, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: true, deferred: true });
  }
}
