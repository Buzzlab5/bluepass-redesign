/**
 * The clock. One hourly cron hits `tickSchedules`; it works out which
 * cadences are due this hour and enqueues one job per agent per bucket, so
 * a cron that fires twice in the same hour cannot double-run anything.
 * Daily work runs at AGENTS_DAILY_HOUR_UTC (default 20:00 UTC, early
 * morning on the east coast of Australia).
 */

import { enqueueJob } from "./jobs";
import { agentsForCadence, ensureAgentsLoaded } from "./registry";
import { expireDecisions } from "./decisions";
import { expireDirectives } from "./directives";
import { requeueStaleJobs } from "./jobs";
import type { Cadence } from "./types";

export function dailyHourUtc(): number {
  const h = Number(process.env.AGENTS_DAILY_HOUR_UTC ?? 20);
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : 20;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

/** Which cadences fire at this instant, with their idempotency buckets. */
export function dueCadences(
  now: Date,
  force?: Cadence[],
): { cadence: Cadence; bucket: string }[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const h = now.getUTCHours();
  const day = `${y}-${pad(m + 1)}-${pad(d)}`;
  const buckets: Record<Cadence, string> = {
    hourly: `${day}T${pad(h)}`,
    daily: day,
    weekly: isoWeek(now),
    monthly: `${y}-${pad(m + 1)}`,
    quarterly: `${y}-Q${Math.floor(m / 3) + 1}`,
  };

  const due = new Set<Cadence>(force ?? []);
  due.add("hourly");
  if (h === dailyHourUtc()) {
    due.add("daily");
    if (now.getUTCDay() === 1) due.add("weekly");
    if (d === 1) {
      due.add("monthly");
      if (m % 3 === 0) due.add("quarterly");
    }
  }
  return [...due].map((cadence) => ({ cadence, bucket: buckets[cadence] }));
}

export async function tickSchedules(
  now: Date,
  force?: Cadence[],
): Promise<{
  enqueued: { agentId: string; cadence: Cadence; bucket: string }[];
  expiredDecisions: number;
  expiredDirectives: number;
  requeuedStale: number;
}> {
  await ensureAgentsLoaded();
  const enqueued: { agentId: string; cadence: Cadence; bucket: string }[] = [];
  for (const { cadence, bucket } of dueCadences(now, force)) {
    for (const agent of agentsForCadence(cadence)) {
      const { created } = await enqueueJob({
        agentId: agent.id,
        kind: "schedule",
        triggerKey: `${cadence}:${bucket}`,
        runAfter: now,
        payload: { cadence, bucket },
      });
      if (created) enqueued.push({ agentId: agent.id, cadence, bucket });
    }
  }
  const expiredDecisions = await expireDecisions(now);
  const expiredDirectives = await expireDirectives(now);
  const requeuedStale = await requeueStaleJobs(now);
  return { enqueued, expiredDecisions, expiredDirectives, requeuedStale };
}
