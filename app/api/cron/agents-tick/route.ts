import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import { agentsEnabled, tickSchedules } from "@/lib/services/agents";
import type { Cadence } from "@/lib/services/agents";

/**
 * The agent clock. Enqueues the scheduled agents whose cadence is due this
 * hour, applies the safe default to any decision nobody answered in time,
 * and requeues jobs a dead drain left locked.
 *
 * `?force=daily` runs a cadence out of turn for testing. It stays
 * idempotent per bucket, so forcing twice in one hour still produces one job.
 */
export const runtime = "nodejs";

const CADENCES: Cadence[] = ["hourly", "daily", "weekly", "monthly", "quarterly"];

async function handle(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (received !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }
  if (!agentsEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  const force = new URL(request.url).searchParams
    .getAll("force")
    .filter((c): c is Cadence => (CADENCES as string[]).includes(c));

  const result = await recordCronRun("agents-tick", () =>
    tickSchedules(new Date(), force.length ? force : undefined),
  );
  return NextResponse.json({ ok: true, enabled: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
