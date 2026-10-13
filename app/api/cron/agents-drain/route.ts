import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/services/monitoring/cron-run-log";
import { agentsEnabled, drainJobs } from "@/lib/services/agents";

/**
 * Agent job drain — runs due AgentJob rows through the one runner.
 *
 * Each tick claims a handful of jobs and stops before the function's time
 * ceiling; whatever is left waits for the next run. Inert unless
 * AGENTS_ENABLED=true, so merging this changes nothing until it is switched
 * on deliberately.
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
  if (!agentsEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, claimed: 0 });
  }

  const result = await recordCronRun("agents-drain", () =>
    drainJobs({
      limit: Number(process.env.AGENTS_DRAIN_LIMIT ?? 5),
      timeBudgetMs: Number(process.env.AGENTS_DRAIN_BUDGET_MS ?? 60_000),
    }),
  );
  return NextResponse.json({ ok: true, enabled: true, ...result });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
