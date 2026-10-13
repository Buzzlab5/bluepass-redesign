import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import { expireLapsedBookings } from "@/lib/services/rails/bookings";
import { railsPayments } from "@/lib/services/rails/payments";
import { settleNativeBookings } from "@/lib/services/rails/settlement";

/**
 * Daily: tidy lapsed holds, then pay operators for native bookings whose trips have
 * run. Unlike the read-only crons, this one moves money, so it refuses to run at all
 * without CRON_SECRET set, and pays nobody until NATIVE_SETTLEMENT_ENABLED is "true".
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || received !== secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const result = await recordCronRun("rails-settle", async () => {
    const expired = await expireLapsedBookings();
    const payments = railsPayments();
    if (process.env.NATIVE_SETTLEMENT_ENABLED !== "true" || !payments) {
      return { expired, settlement: "disabled" };
    }
    return { expired, ...(await settleNativeBookings({ payments })) };
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
