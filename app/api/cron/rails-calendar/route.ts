import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import { googleCalendarApi } from "@/lib/services/rails/google/api";
import { runCalendarSync } from "@/lib/services/rails/google/sync";

/**
 * Every 15 minutes: retries any departure that did not reach Google straight after it
 * changed, and re-reads every connected operator's busy time.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const api = googleCalendarApi();
  if (!api) return NextResponse.json({ ok: true, skipped: "Google is not configured." });
  const result = await recordCronRun("rails-calendar", () => runCalendarSync({ api }));
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
