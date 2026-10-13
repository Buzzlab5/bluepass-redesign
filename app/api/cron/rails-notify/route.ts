import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import {
  releaseStuckClaims,
  sendDailyDigests,
  sendDueReminders,
  sweepMissedConfirmations,
} from "@/lib/services/rails/notify";

/**
 * Hourly: day-before reminders, the operators' evening summaries (each at its own
 * local hour), and any confirmation the moment of booking failed to send. Sends to
 * real people, so it refuses to run without CRON_SECRET.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await recordCronRun("rails-notify", async () => {
    const now = new Date();
    const released = await releaseStuckClaims(now);
    const confirmations = await sweepMissedConfirmations(now);
    const reminders = await sendDueReminders(now);
    const digests = await sendDailyDigests(now);
    return { released, confirmations, reminders, digests };
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
