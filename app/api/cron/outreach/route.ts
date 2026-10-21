import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import { runOutreachBatch } from "@/lib/services/outreach/runner";

/**
 * Daily outreach batch: the next operators and creators go to Instantly, within each
 * campaign's share for the day. A rehearsal (nothing sent) unless OUTREACH_ENABLED=true.
 */
export const runtime = "nodejs";

async function handle(request: NextRequest) {
  /* Closed when the secret is missing, not open: with no CRON_SECRET the old check let anyone start a
     batch. A batch is the one thing here that sends mail, so a forgotten variable must stop it, as it
     does for the other cron routes that move money or bookings. */
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await recordCronRun("outreach", () => runOutreachBatch());
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
