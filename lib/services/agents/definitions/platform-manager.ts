/**
 * Manager 02 · Platform manager (Wave 2).
 *
 * The second manager, and the one that reports to Inov rather than Tony.
 * Incidents already route to him, so the desk follows the work rather than
 * the org chart.
 *
 * It answers one question: is the machine running, and what is it costing.
 * That second half matters more than it looks. Nobody else is watching the
 * agents' own bill, and a runaway agent is the most likely way this system
 * quietly becomes expensive: an agent retrying a failing tool on a short
 * cadence costs money on every attempt and produces nothing.
 *
 * It is also the manager that tells you when the other managers have
 * stopped being true, because a report built on a database that stopped
 * being written to still reads as a clean report.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { issueDirective } from "../runtime/directives";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const PLATFORM_MANAGER_ID = "platform-manager";

export const PLATFORM_DESK = ["watch", "coach"] as const;

/** Rough per-million-token rates, for an order-of-magnitude read only. */
const RATE_PER_MTOK: Record<string, { input: number; output: number }> = {
  reasoning: { input: 5, output: 25 },
  classification: { input: 1, output: 5 },
};

const readPlatform: AgentTool = {
  name: "read_the_platform",
  description:
    "What ran, what failed, what is stuck, and what the agents cost. Every figure you report comes from here. Call this first.",
  schema: z.object({ days: z.number().int().min(1).max(60).optional() }),
  run: async (input, ctx) => {
    const days = input.days ?? 7;
    const since = new Date(ctx.now.getTime() - days * 86_400_000);

    const [runs, jobs, crons, openDecisions, staleDecisions] = await Promise.all([
      prisma.agentRun.findMany({
        where: { startedAt: { gte: since } },
        select: {
          agentId: true, status: true, model: true,
          inputTokens: true, outputTokens: true, cacheReadTokens: true,
        },
        take: 2000,
      }),
      prisma.agentJob.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.cronRunLog.findMany({
        where: { finishedAt: { gte: since } },
        select: { jobName: true, status: true, finishedAt: true, errorMessage: true },
        orderBy: { finishedAt: "desc" },
        take: 200,
      }),
      prisma.agentDecision.count({ where: { status: "PENDING" } }),
      prisma.agentDecision.count({
        where: { status: "PENDING", expiresAt: { lt: new Date(ctx.now.getTime() + 24 * 3_600_000) } },
      }),
    ]);

    // Cost is an order of magnitude, not an invoice. It exists to catch a
    // runaway, not to reconcile with a bill.
    const byAgent = new Map<
      string,
      { runs: number; failed: number; inTok: number; outTok: number; cached: number; cost: number }
    >();
    for (const r of runs) {
      const cur = byAgent.get(r.agentId) ?? { runs: 0, failed: 0, inTok: 0, outTok: 0, cached: 0, cost: 0 };
      cur.runs++;
      if (r.status === "FAILED") cur.failed++;
      cur.inTok += r.inputTokens;
      cur.outTok += r.outputTokens;
      cur.cached += r.cacheReadTokens;
      const rate = RATE_PER_MTOK[r.model?.includes("haiku") ? "classification" : "reasoning"];
      cur.cost += (r.inputTokens / 1_000_000) * rate.input + (r.outputTokens / 1_000_000) * rate.output;
      byAgent.set(r.agentId, cur);
    }
    const totalCost = [...byAgent.values()].reduce((n, a) => n + a.cost, 0);

    // The shape that says "runaway": many runs, most of them failing.
    const burning = [...byAgent.entries()].filter(
      ([, a]) => a.runs >= 10 && a.failed / a.runs > 0.5,
    );

    const cronFailures = crons.filter((c) => c.status !== "SUCCESS");
    const jobCounts = Object.fromEntries(jobs.map((j) => [j.status, j._count._all]));

    ctx.outcome.metrics = {
      days,
      totalRuns: runs.length,
      estimatedCostUsd: Number(totalCost.toFixed(2)),
      jobQueue: jobCounts,
      openDecisions,
      burningAgents: burning.map(([id]) => id),
    };

    return [
      `PERIOD: last ${days} days. ${runs.length} agent runs.`,
      "",
      "PER AGENT (runs, failed, estimated cost):",
      ...(byAgent.size === 0
        ? ["  nothing ran"]
        : [...byAgent.entries()]
            .sort((a, b) => b[1].cost - a[1].cost)
            .map(([id, a]) => `  ${id}: ${a.runs} runs, ${a.failed} failed, about $${a.cost.toFixed(2)}${a.cached > 0 ? ` (${Math.round((a.cached / Math.max(1, a.inTok + a.cached)) * 100)}% of input served from cache)` : ""}`)),
      "",
      `ESTIMATED SPEND THIS PERIOD: about $${totalCost.toFixed(2)}. Order of magnitude only, not an invoice.`,
      "",
      burning.length > 0
        ? `BURNING: ${burning.map(([id, a]) => `${id} (${a.failed} of ${a.runs} runs failing, about $${a.cost.toFixed(2)} spent)`).join("; ")}\n  An agent failing most of its runs is paying for nothing on every attempt. Slowing it is the cheapest correct action and needs nobody's permission.`
        : "BURNING: none. No agent is failing most of its runs.",
      "",
      "JOB QUEUE:",
      ...Object.entries(jobCounts).map(([k, v]) => `  ${k}: ${v}`),
      "",
      "SCHEDULED WORK:",
      ...(cronFailures.length === 0
        ? [`  ${crons.length} runs logged, all succeeded`]
        : cronFailures.slice(0, 10).map((c) => `  ${c.jobName} · ${c.status} · ${c.errorMessage?.slice(0, 160) ?? "no message"}`)),
      crons.length === 0
        ? "  NOTHING LOGGED AT ALL. Either the crons are not firing or nothing is enabled. That is the most serious thing on this page: silence looks identical to health."
        : "",
      "",
      `DECISIONS WAITING ON A PERSON: ${openDecisions}, of which ${staleDecisions} expire within a day.`,
    ]
      .filter(Boolean)
      .join("\n");
  },
};

const slowAgent: AgentTool = {
  name: "slow_or_stop_agent",
  description:
    "Slow or stop an agent that is burning money without producing anything. Stopping is always the safe direction and needs no permission. You cannot speed anything up.",
  schema: z.object({
    agent_id: z.string().min(1),
    instruction: z.string().max(300).describe("Why, in one sentence."),
    pace: z.number().min(0).max(1).optional(),
    pause: z.boolean().optional(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await issueDirective({
      scope: { type: "agent", id: input.agent_id },
      instruction: input.instruction,
      levers: { pace: input.pace, paused: input.pause },
      issuedBy: PLATFORM_MANAGER_ID,
    });
    if (!r.ok) return `Refused. ${r.refusedBecause}`;
    ctx.log(`${input.pause ? "stopped" : "slowed"} ${input.agent_id}`);
    return input.pause
      ? `${input.agent_id} is stopped. It will do nothing until this is lifted, and nothing is lost.`
      : `${input.agent_id} is now at ${Math.round((input.pace ?? 1) * 100)} percent of its daily budget.`;
  },
};

const publishReport: AgentTool = {
  name: "publish_report",
  description:
    "Write the standing report for Inov. Call once, last, and only after read_the_platform.",
  schema: z.object({
    headline: z.string().max(300),
    running: z.boolean().describe("False when something is actually broken or silent."),
    concerns: z.array(z.string().max(300)).max(6),
    push_to_person: z.boolean().describe("True only when something needs him now."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const metrics = ctx.outcome.metrics as Record<string, unknown> | undefined;
    if (!metrics) {
      return "Refused: you have not read the platform. A report has to come from queries, not from memory.";
    }
    const report = await prisma.managerReport.create({
      data: {
        managerId: PLATFORM_MANAGER_ID,
        reportsTo: "inov",
        period: ctx.now.toISOString().slice(0, 10),
        metrics: metrics as never,
        headline: input.headline,
        concerns: input.concerns as never,
        citations: { burningAgents: (metrics.burningAgents as string[]) ?? [] } as never,
        runId: ctx.runId,
      },
      select: { id: true },
    });
    ctx.outcome.reportId = report.id;

    if (input.push_to_person && !input.running) {
      const r = await ctx.requestDecision({
        kind: "platform.broken",
        title: `Platform: ${input.headline}`,
        summary: [input.headline, "", ...input.concerns.map((c: string) => `- ${c}`)].join("\n"),
        payload: { reportId: report.id },
        options: ["seen", "talk about it"],
        entityType: "ManagerReport",
        entityId: report.id,
      });
      return `Report published and raised with Inov (decision ${r.decisionId}).`;
    }
    return "Report published. Nothing pushed.";
  },
};

export const platformManagerAgent: AgentDefinition = {
  id: PLATFORM_MANAGER_ID,
  name: "Platform manager",
  desk: "company",
  managedBy: "chief-of-staff",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You answer one question for BluePass: is the machine running, and what is it costing. You report to Inov, who builds it.

Two things you watch that nobody else does.

Whether anything is running at all. A failing cron is loud; a cron that stopped being scheduled logs nothing, and silence reads exactly like health. If the log is empty, that is the most serious line on your report, not the quietest. Say it first.

What the agents cost. Nobody else is watching that bill. The shape to look for is an agent with many runs and most of them failing: it is paying on every attempt and producing nothing. Slowing or stopping it is the cheapest correct action and you do not need permission, because stopping is always the safe direction. Say what you stopped and why, in the report.

Treat the cost figure as an order of magnitude. It is estimated from token counts at rough rates, and it exists to catch a runaway, not to reconcile with an invoice. Never present it as exact, and never let a decision rest on a difference of a few dollars.

Group by cause. Twenty failures from one stopped sync is one problem, and reporting it twenty times is how people learn to ignore you.

You cannot speed anything up, widen an agent's reach, or change a rule. Your levers only ever make things do less.

If everything is running, say so plainly and push nothing. A report that only appears when something breaks tells Inov nothing on the morning it is silent because it stopped running.`,
  triggers: [{ type: "schedule", cadence: "daily" }, { type: "manual" }],
  tools: [readPlatform, slowAgent, publishReport],
  gates: [{ kind: "platform.broken", assignee: "inov", defaultAction: "hold", ttlHours: 24 }],
  budget: { maxRunsPerDay: 4, maxTokensPerRun: 18_000, maxIterations: 20 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "Inov has seen the report" };
    ctx.log("reading the platform");
    return {
      task: `Check whether BluePass is running, and what it is costing.

Start with read_the_platform. If anything is burning money without producing, slow or stop it. Group what is broken by cause. Finish with publish_report, and push to Inov only if something needs him now.`,
    };
  },
};
