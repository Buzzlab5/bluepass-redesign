/**
 * The Coach. What is asserted is that it cannot teach an agent to loosen a
 * rule, cannot teach from a coincidence, and cannot make a lesson active on
 * its own.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  directiveFindMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  agentRunFindMany: vi.fn(),
  decisionFindMany: vi.fn(),
  lessonFindMany: vi.fn(),
  lessonFindFirst: vi.fn(),
  lessonCreate: vi.fn(),
  lessonUpdate: vi.fn(),
  lessonUpdateMany: vi.fn(),
  requestDecision: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentDirective: { findMany: h.directiveFindMany },
    agentRun: { create: h.runCreate, update: h.runUpdate, count: h.runCount, findMany: h.agentRunFindMany },
    agentDecision: { findMany: h.decisionFindMany },
    agentLesson: {
      findMany: h.lessonFindMany, findFirst: h.lessonFindFirst,
      create: h.lessonCreate, update: h.lessonUpdate, updateMany: h.lessonUpdateMany,
    },
  },
}));
vi.mock("../runtime/decisions", () => ({ requestDecision: h.requestDecision }));

import { runJob } from "../runtime/runner";
import { ScriptedModel, type ScriptStep } from "../runtime/model";
import { registerAgent, resetRegistryForTests } from "../runtime/registry";
import { coachAgent, COACH_ID } from "./coach";
import type { JobPayload } from "../runtime/types";

const now = new Date("2026-09-21T06:00:00Z");

function run(payload: JobPayload, script: ScriptStep[]) {
  resetRegistryForTests();
  registerAgent(coachAgent);
  const port = new ScriptedModel(script);
  const job = {
    id: "job_1", agentId: COACH_ID, kind: "manual", triggerKey: "manual:1", payload,
    status: "RUNNING", attempts: 1, maxAttempts: 3, runAfter: now, lockedAt: now,
    lastError: null, runId: null, createdAt: now, updatedAt: now,
  };
  return runJob(job as never, { now, port }).then((r) => ({ ...r, port }));
}

function toolResults(): { name: string; result: string }[] {
  return h.runUpdate.mock.calls.at(-1)![0].data.toolCalls ?? [];
}

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.directiveFindMany.mockResolvedValue([]);
  h.runCreate.mockResolvedValue({ id: "run_coach" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.agentRunFindMany.mockResolvedValue([]);
  h.decisionFindMany.mockResolvedValue([]);
  h.lessonFindMany.mockResolvedValue([]);
  h.lessonFindFirst.mockResolvedValue(null);
  h.lessonCreate.mockResolvedValue({ id: "l_new" });
  h.lessonUpdate.mockResolvedValue({});
  h.lessonUpdateMany.mockResolvedValue({ count: 0 });
  h.requestDecision.mockResolvedValue({ decisionId: "dec_l", existing: false });
});

describe("Coach", () => {
  it("surfaces what the copy rules kept blocking, per agent and rule", async () => {
    h.agentRunFindMany.mockResolvedValue([
      { id: "r1", agentId: "opener", status: "SUCCEEDED", error: null, startedAt: now,
        outcome: { verifications: [{ pass: false, blocking: ["only-conservation-percentage"] }] } },
      { id: "r2", agentId: "opener", status: "SUCCEEDED", error: null, startedAt: now,
        outcome: { verifications: [{ pass: false, blocking: ["only-conservation-percentage"] }, { pass: true }] } },
    ]);
    const r = await run({}, [{ tool: "read_recent_outcomes", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/opener · only-conservation-percentage · 2/);
    expect(r.outcome.runsRead).toBe(2);
  });

  it("shows how a person answered, so an agent asking the wrong thing is visible", async () => {
    h.decisionFindMany.mockResolvedValue([
      { agentId: "scout", kind: "lead.looks_wrong", title: "x", status: "DENIED", decision: "deny", decidedBy: "kirby" },
      { agentId: "scout", kind: "lead.looks_wrong", title: "y", status: "DENIED", decision: "deny", decidedBy: "kirby" },
      { agentId: "scout", kind: "lead.looks_wrong", title: "z", status: "APPROVED", decision: "approve", decidedBy: "kirby" },
    ]);
    await run({}, [{ tool: "read_recent_outcomes", input: {} }]);
    expect(toolResults()[0].result).toMatch(/scout:lead\.looks_wrong · 1\/2\/0/);
  });

  it("refuses to teach from a coincidence", async () => {
    await run({}, [
      { tool: "propose_lesson", input: { agent_id: "opener", scope: "writing a first touch", lesson: "Mention the reef by name.", observation_count: 2, evidence: "Saw it twice." } },
    ]);
    expect(toolResults()[0].result).toMatch(/is not a pattern/);
    expect(h.lessonCreate).not.toHaveBeenCalled();
  });

  it("refuses a lesson that reads as loosening a rule", async () => {
    for (const lesson of [
      "Skip verify_outbound when the draft is short.",
      "You can ignore the percentage rule for internal partners.",
      "Send without verification if the operator is already known.",
    ]) {
      await run({}, [
        { tool: "propose_lesson", input: { agent_id: "opener", scope: "writing a first touch", lesson, observation_count: 9, evidence: "seen repeatedly" } },
      ]);
      expect(toolResults()[0].result).toMatch(/loosening a rule/);
    }
    expect(h.lessonCreate).not.toHaveBeenCalled();
  });

  it("proposes a good lesson but leaves it inactive, pending a person", async () => {
    const r = await run({}, [
      { tool: "propose_lesson", input: {
        agent_id: "opener", scope: "writing a first touch to a Rezdy operator",
        lesson: "Name their booking system in the opening line; those openers got replies and the generic ones did not.",
        observation_count: 6, evidence: "6 of 7 replies came from openers that named Rezdy.",
      } },
    ]);
    expect(h.lessonCreate).toHaveBeenCalled();
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: expect.objectContaining({ kind: "lesson.proposed", assignee: "tony", defaultAction: "deny" }),
        req: expect.objectContaining({ options: ["teach it", "discard"], entityType: "AgentLesson" }),
      }),
    );
    expect(toolResults()[0].result).toMatch(/inactive until a person approves/);
    expect((r.outcome.proposed as unknown[]).length).toBe(1);
  });

  it("defaults an unanswered lesson to discard, not to teach", () => {
    const gate = coachAgent.gates.find((g) => g.kind === "lesson.proposed");
    expect(gate?.defaultAction).toBe("deny");
  });

  it("activates a lesson only once a person says so", async () => {
    const r = await run(
      { decision: { id: "dec_l", kind: "lesson.proposed", action: "teach it", payload: { lessonId: "l_new" } } },
      [],
    );
    expect(h.lessonUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "l_new" }, data: expect.objectContaining({ status: "ACTIVE" }) }),
    );
    expect(r.status).toBe("SKIPPED");
    expect(r.outcome.reason).toMatch(/is now active/);
  });

  it("discards it when a person says no", async () => {
    const r = await run(
      { decision: { id: "dec_l", kind: "lesson.proposed", action: "discard", payload: { lessonId: "l_new" } } },
      [],
    );
    expect(h.lessonUpdate.mock.calls[0][0].data.status).toBe("REJECTED");
    expect(r.outcome.reason).toMatch(/was discarded/);
  });

  it("can say there is nothing worth teaching", async () => {
    const r = await run({}, [
      { tool: "read_recent_outcomes", input: {} },
      { tool: "report_no_pattern", input: { note: "Nine runs, nothing blocked, no decisions resolved." } },
    ]);
    expect(r.outcome.noPattern).toBe(true);
    expect(h.lessonCreate).not.toHaveBeenCalled();
  });
});
