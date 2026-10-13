import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentJob: {
      create: h.create,
      findUnique: h.findUnique,
      findMany: h.findMany,
      updateMany: h.updateMany,
      update: h.update,
      groupBy: h.groupBy,
    },
  },
}));

import {
  backoffMs,
  claimNextJob,
  deferJob,
  enqueueJob,
  failJob,
  queueSummary,
} from "./jobs";

const now = new Date("2026-09-21T00:00:00Z");

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
});

describe("enqueueJob", () => {
  it("creates a job with its trigger key", async () => {
    h.create.mockResolvedValue({ id: "job_1" });
    const r = await enqueueJob({ agentId: "scout", kind: "schedule", triggerKey: "weekly:2026-W39", payload: { cadence: "weekly" } });
    expect(r).toEqual({ jobId: "job_1", created: true });
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ agentId: "scout", triggerKey: "weekly:2026-W39", maxAttempts: 3 }) }),
    );
  });

  it("is idempotent: a duplicate key returns the existing job instead of a second row", async () => {
    h.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }),
    );
    h.findUnique.mockResolvedValue({ id: "job_existing" });
    const r = await enqueueJob({ agentId: "scout", kind: "event", triggerKey: "k" });
    expect(r).toEqual({ jobId: "job_existing", created: false });
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agentId_triggerKey: { agentId: "scout", triggerKey: "k" } } }),
    );
  });

  it("rethrows anything that is not a unique violation", async () => {
    h.create.mockRejectedValue(new Error("connection lost"));
    await expect(enqueueJob({ agentId: "scout", kind: "event", triggerKey: "k" })).rejects.toThrow("connection lost");
  });
});

describe("claimNextJob", () => {
  it("claims the first due job it can lock and increments attempts", async () => {
    h.findMany.mockResolvedValue([
      { id: "j1", status: "QUEUED", attempts: 0 },
      { id: "j2", status: "QUEUED", attempts: 1 },
    ]);
    h.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const job = await claimNextJob(now);
    expect(job?.id).toBe("j2");
    expect(job?.attempts).toBe(2);
    expect(job?.status).toBe("RUNNING");
  });

  it("returns null when the queue is quiet", async () => {
    h.findMany.mockResolvedValue([]);
    expect(await claimNextJob(now)).toBeNull();
  });
});

describe("failJob", () => {
  it("backs off and requeues while attempts remain", async () => {
    h.update.mockResolvedValue({});
    const status = await failJob({ id: "j1", attempts: 1, maxAttempts: 3 }, "boom", now);
    expect(status).toBe("QUEUED");
    const data = h.update.mock.calls[0][0].data;
    expect(data.status).toBe("QUEUED");
    expect(data.runAfter.getTime()).toBe(now.getTime() + backoffMs(1));
  });

  it("parks the job as FAILED once attempts are exhausted", async () => {
    h.update.mockResolvedValue({});
    const status = await failJob({ id: "j1", attempts: 3, maxAttempts: 3 }, "boom", now);
    expect(status).toBe("FAILED");
    expect(h.update.mock.calls[0][0].data.status).toBe("FAILED");
  });

  it("grows the backoff and caps it", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(5 * 60_000);
    expect(backoffMs(3)).toBe(30 * 60_000);
    expect(backoffMs(9)).toBe(30 * 60_000);
  });
});

describe("deferJob / queueSummary", () => {
  it("defers without burning an attempt", async () => {
    h.update.mockResolvedValue({});
    await deferJob("j1", now);
    expect(h.update.mock.calls[0][0].data).toMatchObject({ status: "QUEUED", runAfter: now, attempts: { decrement: 1 } });
  });

  it("summarises the queue by status", async () => {
    h.groupBy.mockResolvedValue([
      { status: "QUEUED", _count: { _all: 3 } },
      { status: "DONE", _count: { _all: 10 } },
    ]);
    expect(await queueSummary()).toEqual({ QUEUED: 3, DONE: 10 });
  });
});
