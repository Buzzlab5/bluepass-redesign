/**
 * Agent 08 · Watch (Wave 2, pulled forward).
 *
 * Reads the cron log and the agent run log and works out whether BluePass
 * is actually running. The failure this exists for is the quiet one: a
 * sync that stopped three weeks ago, an agent failing every run, a job
 * retrying forever. Nothing alarms, the site looks fine, and supply goes
 * stale underneath it.
 *
 * It diagnoses and raises. It does not restart anything, because a job
 * that failed for a reason will fail again, and re-running it is how a
 * transient fault becomes a duplicated one.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const WATCH_ID = "watch";

/** A job nobody has heard from in this long is presumed stopped. */
const SILENT_HOURS = 26;

const readHealth: AgentTool = {
  name: "read_system_health",
  description:
    "Read the recent cron runs, the failing agent runs and the stuck jobs. Returns what ran, what failed, and what has gone quiet. Call this first.",
  schema: z.object({ hours: z.number().int().min(1).max(336).optional() }),
  run: async (input, ctx) => {
    const since = new Date(ctx.now.getTime() - (input.hours ?? 48) * 3_600_000);

    const [crons, failedRuns, stuckJobs, recentRuns] = await Promise.all([
      prisma.cronRunLog.findMany({
        where: { finishedAt: { gte: since } },
        orderBy: { finishedAt: "desc" },
        take: 100,
        select: { jobName: true, status: true, errorMessage: true, finishedAt: true },
      }),
      prisma.agentRun.findMany({
        where: { status: "FAILED", startedAt: { gte: since } },
        orderBy: { startedAt: "desc" },
        take: 40,
        select: { agentId: true, error: true, triggerKey: true, startedAt: true },
      }),
      prisma.agentJob.findMany({
        where: { status: "FAILED" },
        orderBy: { updatedAt: "desc" },
        take: 25,
        select: { agentId: true, kind: true, triggerKey: true, attempts: true, lastError: true },
      }),
      prisma.agentRun.groupBy({
        by: ["agentId", "status"],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    // Which jobs have been silent rather than failing. A job that stops
    // being scheduled logs nothing at all, which is the hardest failure
    // to see and the one that costs the most.
    const lastSeen = new Map<string, Date>();
    for (const c of crons) {
      const prev = lastSeen.get(c.jobName);
      if (!prev || c.finishedAt > prev) lastSeen.set(c.jobName, c.finishedAt);
    }
    const knownJobs = await prisma.cronRunLog.findMany({
      distinct: ["jobName"],
      select: { jobName: true },
      take: 50,
    });
    const silent: string[] = [];
    for (const { jobName } of knownJobs) {
      const seen = lastSeen.get(jobName);
      if (!seen || seen < new Date(ctx.now.getTime() - SILENT_HOURS * 3_600_000)) {
        silent.push(`${jobName} (last run ${seen ? seen.toISOString().slice(0, 16).replace("T", " ") : "not in this window at all"})`);
      }
    }

    const byAgent = new Map<string, { ok: number; failed: number }>();
    for (const r of recentRuns) {
      const cur = byAgent.get(r.agentId) ?? { ok: 0, failed: 0 };
      if (r.status === "FAILED") cur.failed += r._count._all;
      else cur.ok += r._count._all;
      byAgent.set(r.agentId, cur);
    }

    ctx.outcome.failedRuns = failedRuns.length;
    ctx.outcome.stuckJobs = stuckJobs.length;
    ctx.outcome.silentJobs = silent;

    const cronFailures = crons.filter((c) => c.status !== "SUCCESS");

    return [
      `Window: since ${since.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      "",
      `SILENT (scheduled work nobody has heard from): ${silent.length ? silent.join("; ") : "none"}`,
      "",
      `CRON FAILURES: ${cronFailures.length === 0 ? "none" : ""}`,
      ...cronFailures.slice(0, 12).map((c) => `  ${c.jobName} · ${c.status} · ${c.errorMessage?.slice(0, 200) ?? "no message"} · ${c.finishedAt.toISOString().slice(0, 16).replace("T", " ")}`),
      "",
      `AGENT RUN FAILURES: ${failedRuns.length === 0 ? "none" : ""}`,
      ...failedRuns.slice(0, 12).map((r) => `  ${r.agentId} · ${r.triggerKey} · ${r.error?.slice(0, 200) ?? "no message"}`),
      "",
      `JOBS THAT GAVE UP: ${stuckJobs.length === 0 ? "none" : ""}`,
      ...stuckJobs.slice(0, 12).map((j) => `  ${j.agentId} · ${j.kind} · ${j.triggerKey} · ${j.attempts} attempts · ${j.lastError?.slice(0, 160) ?? ""}`),
      "",
      "SUCCESS RATE PER AGENT:",
      ...[...byAgent.entries()].map(([id, c]) => `  ${id}: ${c.ok} ok, ${c.failed} failed`),
    ].join("\n");
  },
};

const raiseIncident: AgentTool = {
  name: "raise_incident",
  description:
    "Raise one thing that is actually broken, with what you think is causing it. Use once per distinct cause, not once per failed run: twenty failures from one stopped sync are one incident.",
  schema: z.object({
    what_is_broken: z.string().max(200),
    severity: z.enum(["degraded", "broken", "silent_failure"]),
    evidence: z.string().max(600).describe("What in the log says this, quoted."),
    likely_cause: z.string().max(400),
    what_it_affects: z.string().max(300).describe("What a traveller or an operator would actually notice."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const raised = (ctx.outcome.incidents as unknown[] | undefined) ?? [];
    ctx.outcome.incidents = [...raised, input];

    const r = await ctx.requestDecision({
      kind: "incident.raised",
      title: `${input.severity === "silent_failure" ? "Silently stopped" : input.severity === "broken" ? "Broken" : "Degraded"}: ${input.what_is_broken}`,
      summary: [
        input.what_is_broken,
        "",
        `Affects: ${input.what_it_affects}`,
        `Likely cause: ${input.likely_cause}`,
        "",
        "Evidence:",
        input.evidence,
        "",
        "Nothing has been restarted. A job that failed for a reason fails again, and re-running it is how a transient fault becomes a duplicated one.",
      ].join("\n"),
      payload: { ...input },
      options: ["acknowledged", "not an issue"],
      entityType: "Incident",
      entityId: `${input.what_is_broken.slice(0, 60)}:${ctx.now.toISOString().slice(0, 10)}`,
    });
    ctx.log(`incident: ${input.what_is_broken}`);
    return `Raised (decision ${r.decisionId}).`;
  },
};

const reportAllWell: AgentTool = {
  name: "report_all_well",
  description:
    "Record that everything is running. Call this instead of raise_incident when there is nothing wrong, so the absence of an alert means something.",
  schema: z.object({ note: z.string().max(300) }),
  run: async (input, ctx) => {
    ctx.outcome.allWell = true;
    ctx.outcome.note = input.note;
    return "Recorded: everything running.";
  },
};

export const watchAgent: AgentDefinition = {
  id: WATCH_ID,
  name: "Watch",
  desk: "company",
  managedBy: "platform-manager",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You watch whether BluePass is actually running, by reading the cron log, the agent run log and the job queue.

The failure you exist for is the quiet one. A loud error gets noticed. A sync that stopped three weeks ago does not: nothing alarms, the site looks fine, and every operator's availability slowly stops being true. Treat silence as the most serious signal you have, not the absence of one.

How to read what you get:
- Group by cause, not by symptom. Twenty failed runs from one stopped sync is one incident, and reporting it twenty times is how people learn to ignore you.
- A job that has given up after its retries is worse than one still retrying. It will never run again on its own.
- One agent failing every single run is broken. One agent failing occasionally is probably meeting bad data, which is a different problem and a less urgent one.
- Say what it affects in terms someone would notice: travellers seeing stale trips, operators not hearing about a booking, outreach stopped. Not "the cron failed".

You never restart anything and never clear a job. A job that failed for a reason will fail again, and re-running it is how a transient fault becomes a duplicated one. You diagnose and you raise.

If nothing is wrong, say so with report_all_well. A watch that only ever speaks up when something breaks tells you nothing on the morning it is silent because it stopped running.`,
  triggers: [{ type: "schedule", cadence: "daily" }, { type: "manual" }],
  tools: [readHealth, raiseIncident, reportAllWell],
  gates: [{ kind: "incident.raised", assignee: "inov", defaultAction: "hold", ttlHours: 24 }],
  budget: { maxRunsPerDay: 12, maxTokensPerRun: 14_000, maxIterations: 20 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "an incident was acknowledged" };
    ctx.log("reading system health");
    return {
      task: `Check whether BluePass is running.

Start with read_system_health. Group what you find by cause and raise one incident per cause. If nothing is wrong, say so with report_all_well.`,
    };
  },
};
