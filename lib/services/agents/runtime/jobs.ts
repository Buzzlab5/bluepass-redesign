/**
 * Durable job queue on Postgres. One row per (agent, trigger key), so the
 * same event or cadence bucket can never produce two runs. Claiming is an
 * optimistic `updateMany` guarded on status, which is enough for the small
 * number of concurrent drainers the Vercel cron can produce.
 */

import { prisma } from "@/lib/db/prisma";
import { Prisma, type AgentJob } from "@prisma/client";
import type { JobPayload, JobStatus } from "./types";

export type JobKind = "event" | "schedule" | "manual" | "decision";

export type EnqueueInput = {
  agentId: string;
  kind: JobKind;
  triggerKey: string;
  payload?: JobPayload;
  runAfter?: Date;
  maxAttempts?: number;
};

export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/** Idempotent: a second enqueue for the same key returns the existing job. */
export async function enqueueJob(
  input: EnqueueInput,
): Promise<{ jobId: string; created: boolean }> {
  try {
    const job = await prisma.agentJob.create({
      data: {
        agentId: input.agentId,
        kind: input.kind,
        triggerKey: input.triggerKey,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        runAfter: input.runAfter ?? new Date(),
        maxAttempts: input.maxAttempts ?? 3,
      },
    });
    return { jobId: job.id, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.agentJob.findUnique({
      where: {
        agentId_triggerKey: {
          agentId: input.agentId,
          triggerKey: input.triggerKey,
        },
      },
      select: { id: true },
    });
    if (!existing) throw err;
    return { jobId: existing.id, created: false };
  }
}

/** Claims the oldest due job, or null when the queue is quiet. */
export async function claimNextJob(now: Date): Promise<AgentJob | null> {
  const candidates = await prisma.agentJob.findMany({
    where: { status: "QUEUED", runAfter: { lte: now } },
    orderBy: { runAfter: "asc" },
    take: 5,
  });
  for (const c of candidates) {
    const r = await prisma.agentJob.updateMany({
      where: { id: c.id, status: "QUEUED" },
      data: {
        status: "RUNNING",
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (r.count === 1) {
      return {
        ...c,
        status: "RUNNING",
        lockedAt: now,
        attempts: c.attempts + 1,
      };
    }
  }
  return null;
}

/** A drainer that died mid-run leaves RUNNING rows behind; requeue them. */
export async function requeueStaleJobs(
  now: Date,
  staleMs = 15 * 60 * 1000,
): Promise<number> {
  const r = await prisma.agentJob.updateMany({
    where: {
      status: "RUNNING",
      lockedAt: { lt: new Date(now.getTime() - staleMs) },
    },
    data: { status: "QUEUED", lockedAt: null },
  });
  return r.count;
}

export async function completeJob(jobId: string, runId: string): Promise<void> {
  await prisma.agentJob.update({
    where: { id: jobId },
    data: { status: "DONE", runId, lockedAt: null, lastError: null },
  });
}

export function backoffMs(attempt: number): number {
  // 1 min, 5 min, 30 min, then hourly.
  const table = [60_000, 5 * 60_000, 30 * 60_000];
  return table[Math.min(attempt - 1, table.length - 1)] ?? 60 * 60_000;
}

/** Retries with backoff until maxAttempts, then parks the job as FAILED. */
export async function failJob(
  job: Pick<AgentJob, "id" | "attempts" | "maxAttempts">,
  error: string,
  now: Date,
): Promise<JobStatus> {
  const exhausted = job.attempts >= job.maxAttempts;
  await prisma.agentJob.update({
    where: { id: job.id },
    data: exhausted
      ? { status: "FAILED", lastError: error, lockedAt: null }
      : {
          status: "QUEUED",
          lastError: error,
          lockedAt: null,
          runAfter: new Date(now.getTime() + backoffMs(job.attempts)),
        },
  });
  return exhausted ? "FAILED" : "QUEUED";
}

/** Budget exhausted for today: push the job back without burning an attempt. */
export async function deferJob(jobId: string, runAfter: Date): Promise<void> {
  await prisma.agentJob.update({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      runAfter,
      lockedAt: null,
      attempts: { decrement: 1 },
    },
  });
}

export async function cancelJob(jobId: string): Promise<void> {
  await prisma.agentJob.update({
    where: { id: jobId },
    data: { status: "CANCELLED", lockedAt: null },
  });
}

export async function queueSummary(): Promise<Record<string, number>> {
  const rows = await prisma.agentJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}
