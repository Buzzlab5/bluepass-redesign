/**
 * The daily batch: each campaign gets up to its share for the day (OUTREACH_DAILY_OPERATORS,
 * OUTREACH_DAILY_CREATORS), counting anyone already added today, so running it twice is safe.
 * Instantly then spaces the sends across business hours from the warmed mailboxes.
 */

import { creatorCandidates, enrol, enrolledToday, operatorCandidates, outreachLive, type Skipped } from "./enrol";

export function dailyShares(env: Record<string, string | undefined> = process.env) {
  const n = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Math.max(0, Number(v)) : d);
  return { operators: n(env.OUTREACH_DAILY_OPERATORS, 20), creators: n(env.OUTREACH_DAILY_CREATORS, 10) };
}

export async function runOutreachBatch(now = new Date()) {
  const live = outreachLive();
  const shares = dailyShares();
  const left = {
    operators: Math.max(0, shares.operators - (live ? await enrolledToday("operators-au", now) : 0)),
    creators: Math.max(0, shares.creators - (live ? await enrolledToday("creators-au", now) : 0)),
  };
  const [ops, creators] = await Promise.all([
    left.operators ? operatorCandidates(left.operators) : { ready: [], skipped: [] as Skipped[] },
    left.creators ? creatorCandidates(left.creators) : { ready: [], skipped: [] as Skipped[] },
  ]);
  const result = await enrol([...ops.ready, ...creators.ready], { live });
  return {
    shares,
    ready: { operators: ops.ready.length, creators: creators.ready.length },
    skipped: [...ops.skipped, ...creators.skipped].length,
    ...result,
  };
}
