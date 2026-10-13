import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import { rezdyApi } from "@/lib/services/channels/rezdy/api";
import { reconcileRezdyBookings, releaseLapsedRezdyHolds } from "@/lib/services/channels/rezdy/booking";
import { runRezdyChannelSync } from "@/lib/services/channels/rezdy/sync";
import { railsPayments } from "@/lib/services/rails/payments";

/**
 * Every 15 minutes, for operators on Rezdy: new and changed trips come in, trips no
 * longer shared stop selling, bookings cancelled or moved in Rezdy are followed here
 * (refunds included), and seats held for abandoned checkouts are given back.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const api = rezdyApi();
  if (!api) return NextResponse.json({ ok: true, skipped: "Rezdy is not configured." });
  const result = await recordCronRun("channel-sync", async () => {
    const now = new Date();
    const released = await releaseLapsedRezdyHolds(now, api);
    const bookings = await reconcileRezdyBookings(now, api, railsPayments());
    const trips = await runRezdyChannelSync(now, api);
    return { released, bookings, trips };
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
