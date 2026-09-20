/**
 * The Growth analyst and the Platform manager. The two properties under
 * test are refusals of a different kind: refusing to read a trend out of
 * numbers too small to carry one, and refusing to write a report from
 * anything but a query.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  directiveFindMany: vi.fn(),
  directiveCreate: vi.fn(),
  lessonFindMany: vi.fn(),
  lessonUpdateMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  runFindMany: vi.fn(),
  jobGroupBy: vi.fn(),
  cronFindMany: vi.fn(),
  decisionCount: vi.fn(),
  reportCreate: vi.fn(),
  waitlistGroupBy: vi.fn(),
  waitlistCount: vi.fn(),
  signupCount: vi.fn(),
  kaiGroupBy: vi.fn(),
  kaiCount: vi.fn(),
  clickCount: vi.fn(),
  inquiryCount: vi.fn(),
  listingCount: vi.fn(),
  postCount: vi.fn(),
  requestDecision: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentDirective: { findMany: h.directiveFindMany, create: h.directiveCreate },
    agentLesson: { findMany: h.lessonFindMany, updateMany: h.lessonUpdateMany },
    agentRun: { create: h.runCreate, update: h.runUpdate, count: h.runCount, findMany: h.runFindMany },
    agentJob: { groupBy: h.jobGroupBy },
    agentDecision: { count: h.decisionCount },
    cronRunLog: { findMany: h.cronFindMany },
    managerReport: { create: h.reportCreate },
    waitlistSignup: { groupBy: h.waitlistGroupBy, count: h.waitlistCount },
    signupLead: { count: h.signupCount },
    kaiSession: { groupBy: h.kaiGroupBy, count: h.kaiCount },
    referralClick: { count: h.clickCount },
    bookingInquiry: { count: h.inquiryCount },
    operatorListing: { count: h.listingCount },
    blogPost: { count: h.postCount },
  },
}));
vi.mock("../runtime/decisions", () => ({ requestDecision: h.requestDecision }));

import { runJob } from "../runtime/runner";
import { ScriptedModel, type ScriptStep } from "../runtime/model";
import { registerAgent, resetRegistryForTests } from "../runtime/registry";
import { growthAnalystAgent, GROWTH_ANALYST_ID } from "./growth-analyst";
import { platformManagerAgent, PLATFORM_MANAGER_ID } from "./platform-manager";
import type { AgentDefinition, JobPayload } from "../runtime/types";

const now = new Date("2026-09-21T06:00:00Z");

function run(agent: AgentDefinition, payload: JobPayload, script: ScriptStep[]) {
  resetRegistryForTests();
  registerAgent(agent);
  const port = new ScriptedModel(script);
  const job = {
    id: "job_1", agentId: agent.id, kind: "manual", triggerKey: "manual:1", payload,
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
  h.directiveCreate.mockResolvedValue({ id: "d_1" });
  h.lessonFindMany.mockResolvedValue([]);
  h.lessonUpdateMany.mockResolvedValue({ count: 0 });
  h.runCreate.mockResolvedValue({ id: "run_1" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.runFindMany.mockResolvedValue([]);
  h.jobGroupBy.mockResolvedValue([]);
  h.cronFindMany.mockResolvedValue([]);
  h.decisionCount.mockResolvedValue(0);
  h.reportCreate.mockResolvedValue({ id: "rep_1" });
  h.waitlistGroupBy.mockResolvedValue([]);
  h.waitlistCount.mockResolvedValue(0);
  h.signupCount.mockResolvedValue(0);
  h.kaiGroupBy.mockResolvedValue([]);
  h.kaiCount.mockResolvedValue(0);
  h.clickCount.mockResolvedValue(0);
  h.inquiryCount.mockResolvedValue(0);
  h.listingCount.mockResolvedValue(0);
  h.postCount.mockResolvedValue(0);
  h.requestDecision.mockResolvedValue({ decisionId: "dec_1", existing: false });
});

// ─── 15 Growth analyst ───────────────────────────────────────────────────────

describe("Growth analyst", () => {
  it("marks a comparison too small to read, rather than presenting it as a trend", async () => {
    h.waitlistGroupBy.mockResolvedValue([{ role: "TRAVELLER", _count: { _all: 11 } }]);
    h.waitlistCount.mockResolvedValue(8);
    await run(growthAnalystAgent, {}, [{ tool: "read_the_funnel", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/waitlist signups: 11 this period, 8 last \(up\) — TOO FEW TO MEAN ANYTHING/);
    expect(out).toMatch(/saying so is the right answer/);
  });

  it("reads a comparison once the two periods together clear the threshold", async () => {
    h.waitlistGroupBy.mockResolvedValue([{ role: "TRAVELLER", _count: { _all: 40 } }]);
    h.waitlistCount.mockResolvedValue(25);
    await run(growthAnalystAgent, {}, [{ tool: "read_the_funnel", input: {} }]);
    expect(toolResults()[0].result).toMatch(/waitlist signups: 40 this period, 25 last \(up\)$/m);
  });

  it("says plainly that nothing below the enquiry stage can improve with no inventory", async () => {
    h.listingCount.mockResolvedValue(0);
    await run(growthAnalystAgent, {}, [{ tool: "read_the_funnel", input: {} }]);
    expect(toolResults()[0].result).toMatch(/NOTHING IS BOOKABLE/);
    expect(toolResults()[0].result).toMatch(/no test you propose should assume otherwise/);
  });

  it("treats 'too early to say' as a complete answer", async () => {
    const r = await run(growthAnalystAgent, {}, [
      { tool: "read_the_funnel", input: {} },
      { tool: "write_readout", input: { headline: "Four conversations, none reaching an enquiry.", too_early_to_say: true, observations: [], proposed_tests: [] } },
    ]);
    expect(r.outcome.tooEarly).toBe(true);
    expect(toolResults()[1].result).toMatch(/inventing a trend from them would cost real work/);
  });

  it("accepts a readout with no test proposed", async () => {
    await run(growthAnalystAgent, {}, [
      { tool: "read_the_funnel", input: {} },
      { tool: "write_readout", input: { headline: "Flat.", too_early_to_say: false, observations: ["Nothing moved."], proposed_tests: [] } },
    ]);
    expect(toolResults()[1].result).toMatch(/a readout that always ends in a test is a readout nobody can trust/);
  });

  it("refuses a readout written without reading the funnel", async () => {
    await run(growthAnalystAgent, {}, [
      { tool: "write_readout", input: { headline: "Growth is strong.", too_early_to_say: false, observations: [], proposed_tests: [] } },
    ]);
    expect(toolResults()[0].result).toMatch(/has to come from queries, not from memory/);
  });
});

// ─── Platform manager ────────────────────────────────────────────────────────

describe("Platform manager", () => {
  it("calls out an agent burning money without producing anything", async () => {
    h.runFindMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        agentId: "opener",
        status: i < 9 ? "FAILED" : "SUCCEEDED",
        model: "claude-opus-5",
        inputTokens: 40_000,
        outputTokens: 2_000,
        cacheReadTokens: 0,
      })),
    );
    const r = await run(platformManagerAgent, {}, [{ tool: "read_the_platform", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/BURNING: opener \(9 of 12 runs failing/);
    expect(out).toMatch(/Slowing it is the cheapest correct action/);
    expect((r.outcome.metrics as { burningAgents: string[] }).burningAgents).toEqual(["opener"]);
  });

  it("treats an entirely empty cron log as the most serious line", async () => {
    h.cronFindMany.mockResolvedValue([]);
    await run(platformManagerAgent, {}, [{ tool: "read_the_platform", input: {} }]);
    expect(toolResults()[0].result).toMatch(/NOTHING LOGGED AT ALL/);
    expect(toolResults()[0].result).toMatch(/silence looks identical to health/);
  });

  it("presents cost as an order of magnitude, never as an invoice", async () => {
    h.runFindMany.mockResolvedValue([
      { agentId: "coach", status: "SUCCEEDED", model: "claude-opus-5", inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0 },
    ]);
    const r = await run(platformManagerAgent, {}, [{ tool: "read_the_platform", input: {} }]);
    const out = toolResults()[0].result;
    // 1M input at $5 plus 100k output at $25 is about $7.50.
    expect(out).toMatch(/about \$7\.50/);
    expect(out).toMatch(/Order of magnitude only, not an invoice/);
    expect((r.outcome.metrics as { estimatedCostUsd: number }).estimatedCostUsd).toBeCloseTo(7.5, 1);
  });

  it("can slow an agent without anyone's permission", async () => {
    await run(platformManagerAgent, {}, [
      { tool: "slow_or_stop_agent", input: { agent_id: "opener", instruction: "Failing 9 of 12 runs and paying on each.", pause: true } },
    ]);
    expect(h.directiveCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ levers: { pace: undefined, paused: true } }) }),
    );
    expect(toolResults()[0].result).toMatch(/nothing is lost/);
  });

  it("cannot speed an agent up, because a directive only ever narrows", async () => {
    await run(platformManagerAgent, {}, [
      { tool: "slow_or_stop_agent", input: { agent_id: "opener", instruction: "Run it harder.", pace: 2 } },
    ]);
    expect(toolResults()[0].result).toMatch(/INVALID_INPUT/);
    expect(h.directiveCreate).not.toHaveBeenCalled();
  });

  it("writes its report to Inov, not to Tony", async () => {
    await run(platformManagerAgent, {}, [
      { tool: "read_the_platform", input: {} },
      { tool: "publish_report", input: { headline: "Everything running.", running: true, concerns: [], push_to_person: false } },
    ]);
    expect(h.reportCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ managerId: PLATFORM_MANAGER_ID, reportsTo: "inov" }) }),
    );
    expect(h.requestDecision).not.toHaveBeenCalled();
  });

  it("refuses to report from memory", async () => {
    await run(platformManagerAgent, {}, [
      { tool: "publish_report", input: { headline: "All fine.", running: true, concerns: [], push_to_person: false } },
    ]);
    expect(toolResults()[0].result).toMatch(/has to come from queries, not from memory/);
    expect(h.reportCreate).not.toHaveBeenCalled();
  });

  it("only interrupts Inov when something is actually broken", async () => {
    await run(platformManagerAgent, {}, [
      { tool: "read_the_platform", input: {} },
      { tool: "publish_report", input: { headline: "Rezdy sync silent for three days.", running: false, concerns: ["No cron rows at all."], push_to_person: true } },
    ]);
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ gate: expect.objectContaining({ kind: "platform.broken", assignee: "inov" }) }),
    );
  });
});

// ─── The manager layer as a whole ────────────────────────────────────────────

describe("Every agent that is managed names a manager that exists", async () => {
  it("has no orphan managedBy", async () => {
    const { ALL_AGENTS } = await import("./index");
    const ids = new Set(ALL_AGENTS.map((a) => a.id));
    for (const a of ALL_AGENTS) {
      if (a.managedBy) expect(ids.has(a.managedBy)).toBe(true);
    }
  });

  it("does not let a manager manage itself", async () => {
    const { ALL_AGENTS } = await import("./index");
    for (const a of ALL_AGENTS) expect(a.managedBy).not.toBe(a.id);
  });
});
