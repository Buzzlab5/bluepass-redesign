import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";


const h = vi.hoisted(() => ({
  lessonFindMany: vi.fn(),
  lessonUpdateMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  jobUpdate: vi.fn(),
  requestDecision: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentLesson: { findMany: h.lessonFindMany, updateMany: h.lessonUpdateMany },
    agentRun: { create: h.runCreate, update: h.runUpdate, count: h.runCount },
    agentJob: { findMany: h.jobFindMany, updateMany: h.jobUpdateMany, update: h.jobUpdate },
  },
}));
vi.mock("./decisions", () => ({ requestDecision: h.requestDecision }));
vi.mock("../definitions", () => ({ registerAllAgents: () => {} }));

import { drainJobs, runJob, RUNTIME_RULES } from "./runner";
import { ScriptedModel } from "./model";
import { registerAgent, resetRegistryForTests } from "./registry";
import type { AgentDefinition } from "./types";

const now = new Date("2026-09-21T01:00:00Z");

function testAgent(over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "tester",
    name: "Tester",
    desk: "company",
    plane: "product",
    wave: 1,
    modelTier: "reasoning",
    persona: "You are the tester.",
    triggers: [{ type: "manual" }],
    gates: [{ kind: "test.gate", assignee: "any", defaultAction: "deny", ttlHours: 1 }],
    budget: { maxRunsPerDay: 2, maxTokensPerRun: 500, maxIterations: 3 },
    tools: [
      {
        name: "record",
        description: "records a value",
        schema: z.object({ value: z.string() }),
        writes: true,
        run: async (input, ctx) => {
          ctx.outcome.recorded = input.value;
          return `recorded ${input.value}`;
        },
      },
      {
        name: "ask",
        description: "asks a person",
        schema: z.object({ why: z.string() }),
        run: async (input, ctx) => {
          const r = await ctx.requestDecision({ kind: "test.gate", title: "Q", summary: input.why });
          return `decision ${r.decisionId}`;
        },
      },
    ],
    buildTask: async (payload) => ({ task: `handle ${JSON.stringify(payload)}` }),
    ...over,
  };
}

const job = (over: Record<string, unknown> = {}) => ({
  id: "job_1",
  agentId: "tester",
  kind: "manual",
  triggerKey: "manual:1",
  payload: { hello: "world" },
  status: "RUNNING",
  attempts: 1,
  maxAttempts: 3,
  runAfter: now,
  lockedAt: now,
  lastError: null,
  runId: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.lessonFindMany.mockResolvedValue([]);
  h.lessonUpdateMany.mockResolvedValue({ count: 0 });
  resetRegistryForTests();
  registerAgent(testAgent());
  h.runCreate.mockResolvedValue({ id: "run_1" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.requestDecision.mockResolvedValue({ decisionId: "dec_1", existing: false });
  h.jobUpdate.mockResolvedValue({});
});

describe("runJob", () => {
  it("runs the model with exactly the agent's tools, records tool calls and the outcome", async () => {
    const port = new ScriptedModel([{ tool: "record", input: { value: "alpha" } }, { text: "Done: recorded alpha." }]);
    const r = await runJob(job() as never, { now, port });

    expect(r.status).toBe("SUCCEEDED");
    expect(r.outcome.recorded).toBe("alpha");
    expect(port.calls[0].system).toContain("You are the tester.");
    expect(port.calls[0].system).toContain(RUNTIME_RULES.trim());
    expect(port.calls[0].user).toBe('handle {"hello":"world"}');
    expect(port.calls[0].tools.map((t) => t.name)).toEqual(["record", "ask"]);
    expect(port.calls[0].thinking).toBe(true);

    const final = h.runUpdate.mock.calls.at(-1)![0].data;
    expect(final.status).toBe("SUCCEEDED");
    expect(final.toolCalls).toEqual([expect.objectContaining({ name: "record", input: { value: "alpha" }, result: "recorded alpha" })]);
    expect(final.outcome).toMatchObject({ recorded: "alpha", summary: "Done: recorded alpha." });
  });

  it("validates tool input against the schema and reports bad input to the model instead of crashing", async () => {
    const port = new ScriptedModel([{ tool: "record", input: { value: 42 } }]);
    const r = await runJob(job() as never, { now, port });
    expect(r.status).toBe("SUCCEEDED");
    const final = h.runUpdate.mock.calls.at(-1)![0].data;
    expect(final.toolCalls[0]).toMatchObject({ name: "record", error: true });
    expect(final.toolCalls[0].result).toMatch(/INVALID_INPUT/);
    expect(final.outcome.recorded).toBeUndefined();
  });

  it("routes decisions through the agent's gate policy and remembers them on the run", async () => {
    const port = new ScriptedModel([{ tool: "ask", input: { why: "refund over limit" } }]);
    const r = await runJob(job() as never, { now, port });
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "tester", runId: "run_1", gate: expect.objectContaining({ kind: "test.gate", defaultAction: "deny" }), req: expect.objectContaining({ summary: "refund over limit" }) }),
    );
    expect(r.outcome.decisions).toEqual(["dec_1"]);
  });

  it("refuses a decision kind the agent has no gate for", async () => {
    resetRegistryForTests();
    registerAgent(testAgent({ gates: [] }));
    const port = new ScriptedModel([{ tool: "ask", input: { why: "x" } }]);
    const r = await runJob(job() as never, { now, port });
    const final = h.runUpdate.mock.calls.at(-1)![0].data;
    expect(final.toolCalls[0].result).toMatch(/no gate policy/);
    expect(r.status).toBe("SUCCEEDED");
  });

  it("skips without a model call when buildTask says there is nothing to do", async () => {
    resetRegistryForTests();
    registerAgent(testAgent({ buildTask: async () => ({ skip: "nothing due" }) }));
    const port = new ScriptedModel([]);
    const r = await runJob(job() as never, { now, port });
    expect(r.status).toBe("SKIPPED");
    expect(port.calls).toHaveLength(0);
    expect(h.runUpdate.mock.calls.at(-1)![0].data).toMatchObject({ status: "SKIPPED", outcome: { reason: "nothing due" } });
  });

  it("records a failure, audits it and rethrows so the queue can retry", async () => {
    resetRegistryForTests();
    registerAgent(testAgent({ buildTask: async () => { throw new Error("context load failed"); } }));
    await expect(runJob(job() as never, { now, port: new ScriptedModel([]) })).rejects.toThrow("context load failed");
    expect(h.runUpdate.mock.calls.at(-1)![0].data).toMatchObject({ status: "FAILED", error: "context load failed" });
  });
});

describe("drainJobs", () => {
  it("claims, runs and completes due jobs, and fails the ones that throw", async () => {
    resetRegistryForTests();
    registerAgent(testAgent());
    registerAgent(testAgent({ id: "broken", buildTask: async () => { throw new Error("nope"); } }));
    h.jobFindMany
      .mockResolvedValueOnce([job({ id: "j_ok", attempts: 0 }), job({ id: "j_bad", agentId: "broken", attempts: 0 })])
      .mockResolvedValueOnce([job({ id: "j_bad", agentId: "broken", attempts: 0 })])
      .mockResolvedValue([]);
    h.jobUpdateMany.mockResolvedValue({ count: 1 });
    const port = new ScriptedModel([{ tool: "record", input: { value: "x" } }]);

    const stats = await drainJobs({ now, limit: 5, port });
    expect(stats).toMatchObject({ claimed: 2, succeeded: 1, failed: 1 });
    expect(stats.errors[0]).toMatchObject({ jobId: "j_bad", agentId: "broken", error: "nope" });
    const updates = h.jobUpdate.mock.calls.map((c) => c[0]);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ where: { id: "j_ok" }, data: expect.objectContaining({ status: "DONE", runId: "run_1" }) }),
        expect.objectContaining({ where: { id: "j_bad" }, data: expect.objectContaining({ status: "QUEUED", lastError: "nope" }) }),
      ]),
    );
  });

  it("defers a job to tomorrow once the agent's daily budget is spent", async () => {
    h.jobFindMany.mockResolvedValueOnce([job({ id: "j_late", attempts: 0 })]).mockResolvedValue([]);
    h.jobUpdateMany.mockResolvedValue({ count: 1 });
    h.runCount.mockResolvedValue(2);
    const port = new ScriptedModel([]);
    const stats = await drainJobs({ now, port });
    expect(stats).toMatchObject({ claimed: 1, deferred: 1, succeeded: 0 });
    expect(port.calls).toHaveLength(0);
    const defer = h.jobUpdate.mock.calls[0][0];
    expect(defer.data.runAfter.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(defer.data.attempts).toEqual({ decrement: 1 });
  });
});
