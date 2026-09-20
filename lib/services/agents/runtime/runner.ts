/**
 * The one runner. Claims a job, checks the agent's budget, builds the task
 * from the trigger, runs the model with exactly that agent's tools, and
 * records the run. Every run is idempotent (one job per trigger key) and
 * every run is logged, including what it cost.
 */

import { prisma } from "@/lib/db/prisma";
import { Prisma, type AgentJob } from "@prisma/client";
import { requestDecision } from "./decisions";
import { claimNextJob, completeJob, deferJob, failJob } from "./jobs";
import { MODEL_IDS, getModelPort } from "./model";
import { ensureAgentsLoaded, getAgent } from "./registry";
import { loadLessons, renderLessons } from "./lessons";
import type {
  AgentDefinition,
  DecisionRequest,
  JobPayload,
  ModelPort,
  RunContext,
  RunStatus,
} from "./types";

/**
 * Appended to every persona. Stable text, so it stays inside the cached
 * prefix. These are the house rules every agent inherits.
 */
export const RUNTIME_RULES = `

House rules (apply to every action):
- Act only through the tools you are given. Never claim an action happened unless a tool confirmed it.
- Never invent a number, a name, an availability, a price or a policy. If a tool did not return it, say so.
- Money moves only through the settlement rails. You may propose, request a decision, or prepare; you never transfer, refund or pay directly.
- Customer- and operator-facing copy states only one percentage, the fixed 5% of every booking that goes to ocean conservation. Never state any other percentage, never promise a price match, never use emojis or em dashes. Say "no markup" and "your own rates", never "keep 100%".
- Never claim to be human. When something needs a person, use the decision tool; do not stall the person you are talking to.
- When you are done, end with one short line saying what you did and what, if anything, is waiting on a person.`;

export type RunOutcome = {
  runId: string;
  status: RunStatus;
  outcome: Record<string, unknown>;
  error?: string;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function runsToday(agentId: string, now: Date): Promise<number> {
  return prisma.agentRun.count({
    where: {
      agentId,
      startedAt: { gte: startOfUtcDay(now) },
      status: { not: "SKIPPED" },
    },
  });
}

function makeContext(
  agent: AgentDefinition,
  runId: string,
  job: Pick<AgentJob, "id" | "triggerKey"> | null,
  payload: JobPayload,
  now: Date,
): RunContext {
  const lines: string[] = [];
  const ctx: RunContext = {
    agent,
    runId,
    jobId: job?.id ?? null,
    triggerKey: job?.triggerKey ?? "manual",
    payload,
    now,
    outcome: {},
    toolCalls: [],
    log: (line) => {
      lines.push(line);
      ctx.outcome.log = lines.slice(-40);
    },
    requestDecision: async (req: DecisionRequest) => {
      const gate = agent.gates.find((g) => g.kind === req.kind);
      if (!gate) {
        throw new Error(
          `Agent "${agent.id}" has no gate policy for decision kind "${req.kind}"`,
        );
      }
      const r = await requestDecision({ agentId: agent.id, runId, gate, req, now });
      const pending = (ctx.outcome.decisions as string[] | undefined) ?? [];
      ctx.outcome.decisions = [...pending, r.decisionId];
      return r;
    },
  };
  return ctx;
}

/** Runs one claimed job. Throws on failure so the drain can retry it. */
export async function runJob(
  job: AgentJob,
  opts: { now?: Date; port?: ModelPort } = {},
): Promise<RunOutcome> {
  await ensureAgentsLoaded();
  const now = opts.now ?? new Date();
  const agent = getAgent(job.agentId);
  const payload = (job.payload ?? {}) as JobPayload;

  const run = await prisma.agentRun.create({
    data: {
      agentId: agent.id,
      jobId: job.id,
      triggerKey: job.triggerKey,
      model: MODEL_IDS[agent.modelTier],
    },
  });
  const ctx = makeContext(agent, run.id, job, payload, now);

  try {
    const build = await agent.buildTask(payload, ctx);
    if (build.skip !== undefined) {
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "SKIPPED",
          outcome: { reason: build.skip, ...ctx.outcome } as Prisma.InputJsonValue,
          finishedAt: now,
        },
      });
      return { runId: run.id, status: "SKIPPED", outcome: { reason: build.skip } };
    }

    // Lessons go in the task, never the persona: the persona is what an
    // agent is and stays cached, a lesson is something it noticed lately
    // and may later be wrong about.
    const lessons = await loadLessons(agent.id);
    if (lessons.length > 0) ctx.outcome.lessonsApplied = lessons.map((l) => l.id);

    const port = opts.port ?? getModelPort();
    const result = await port.run({
      model: MODEL_IDS[agent.modelTier],
      system: agent.persona + RUNTIME_RULES,
      user: build.task + renderLessons(lessons),
      tools: agent.tools,
      ctx,
      maxTokens: agent.budget.maxTokensPerRun,
      maxIterations: agent.budget.maxIterations,
      thinking: agent.modelTier === "reasoning",
    });

    const outcome = {
      ...ctx.outcome,
      summary: result.text.slice(0, 2000),
      stopReason: result.stopReason,
    };
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
        toolCalls: ctx.toolCalls as unknown as Prisma.InputJsonValue,
        outcome: outcome as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return { runId: run.id, status: "SUCCEEDED", outcome };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: message.slice(0, 2000),
        toolCalls: ctx.toolCalls as unknown as Prisma.InputJsonValue,
        outcome: ctx.outcome as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

export type DrainStats = {
  claimed: number;
  succeeded: number;
  skipped: number;
  deferred: number;
  failed: number;
  errors: { jobId: string; agentId: string; error: string }[];
};

/**
 * Processes due jobs until the queue is quiet, the limit is reached, or the
 * time budget runs out (a serverless function has a hard ceiling).
 */
export async function drainJobs(
  opts: { now?: Date; limit?: number; timeBudgetMs?: number; port?: ModelPort } = {},
): Promise<DrainStats> {
  await ensureAgentsLoaded();
  const started = Date.now();
  const limit = opts.limit ?? 5;
  const budget = opts.timeBudgetMs ?? 70_000;
  const stats: DrainStats = {
    claimed: 0,
    succeeded: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
    errors: [],
  };

  while (stats.claimed < limit && Date.now() - started < budget) {
    const now = opts.now ?? new Date();
    const job = await claimNextJob(now);
    if (!job) break;
    stats.claimed++;

    const agent = getAgent(job.agentId);
    if ((await runsToday(agent.id, now)) >= agent.budget.maxRunsPerDay) {
      await deferJob(job.id, new Date(startOfUtcDay(now).getTime() + 86_400_000));
      stats.deferred++;
      continue;
    }

    try {
      const r = await runJob(job, { now, port: opts.port });
      await completeJob(job.id, r.runId);
      if (r.status === "SKIPPED") stats.skipped++;
      else stats.succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failJob(job, message.slice(0, 1000), now);
      stats.failed++;
      stats.errors.push({
        jobId: job.id,
        agentId: job.agentId,
        error: message.slice(0, 300),
      });
    }
  }
  return stats;
}
