import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import { runOutreachBatch } from "@/lib/services/outreach/runner";

/**
 * Daily outreach batch: the next operators and creators go to Instantly, within each
 * campaign's share for the day. A rehearsal (nothing sent) unless OUTREACH_ENABLED=true.
 */
export const runtime = "nodejs";

async function handle(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (received !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
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
