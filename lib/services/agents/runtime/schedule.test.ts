import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  requeueStaleJobs: vi.fn(),
  expireDecisions: vi.fn(),
}));

vi.mock("./jobs", () => ({ enqueueJob: h.enqueueJob, requeueStaleJobs: h.requeueStaleJobs }));
vi.mock("./decisions", () => ({ expireDecisions: h.expireDecisions }));
vi.mock("../definitions", () => ({ registerAllAgents: () => {} }));

import { dueCadences, isoWeek, tickSchedules } from "./schedule";
import { registerAgent, resetRegistryForTests } from "./registry";
import type { AgentDefinition, TriggerSpec } from "./types";

function def(id: string, triggers: TriggerSpec[]): AgentDefinition {
  return {
    id, name: id, desk: "company", plane: "operating", wave: 2, modelTier: "reasoning", persona: "p",
    triggers, tools: [], gates: [],
    budget: { maxRunsPerDay: 5, maxTokensPerRun: 1000, maxIterations: 2 },
    buildTask: async () => ({ task: "t" }),
  };
}

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  resetRegistryForTests();
  delete process.env.AGENTS_DAILY_HOUR_UTC;
  h.enqueueJob.mockResolvedValue({ jobId: "j", created: true });
  h.requeueStaleJobs.mockResolvedValue(0);
  h.expireDecisions.mockResolvedValue(0);
});

describe("dueCadences", () => {
  it("fires only the hourly bucket outside the daily hour", () => {
    const due = dueCadences(new Date("2026-09-21T03:10:00Z"));
    expect(due.map((d) => d.cadence)).toEqual(["hourly"]);
    expect(due[0].bucket).toBe("2026-09-21T03");
  });

  it("fires daily, weekly, monthly and quarterly on a Monday the 1st at the daily hour", () => {
    // 2026-06-01 is a Monday; June starts Q2 in the 0-based month check (5 % 3 !== 0), so not quarterly.
    const june = dueCadences(new Date("2026-06-01T20:30:00Z")).map((d) => d.cadence);
    expect(june).toEqual(expect.arrayContaining(["hourly", "daily", "weekly", "monthly"]));
    expect(june).not.toContain("quarterly");
    // 2026-10-01 is a Thursday, the first day of Q4.
    const oct = dueCadences(new Date("2026-10-01T20:00:00Z"));
    expect(oct.map((d) => d.cadence)).toEqual(expect.arrayContaining(["daily", "monthly", "quarterly"]));
    expect(oct.find((d) => d.cadence === "quarterly")?.bucket).toBe("2026-Q4");
    expect(oct.map((d) => d.cadence)).not.toContain("weekly");
  });

  it("honours a forced cadence and a configured daily hour", () => {
    process.env.AGENTS_DAILY_HOUR_UTC = "6";
    const forced = dueCadences(new Date("2026-09-21T06:00:00Z"), ["quarterly"]);
    expect(forced.map((d) => d.cadence)).toEqual(expect.arrayContaining(["hourly", "daily", "weekly", "quarterly"]));
    expect(isoWeek(new Date("2026-09-21T06:00:00Z"))).toMatch(/^2026-W\d{2}$/);
  });
});

describe("tickSchedules", () => {
  it("enqueues one idempotent job per agent per due bucket and does the housekeeping", async () => {
    registerAgent(def("daily-agent", [{ type: "schedule", cadence: "daily" }]));
    registerAgent(def("hourly-agent", [{ type: "schedule", cadence: "hourly" }]));
    registerAgent(def("event-agent", [{ type: "event", pattern: "x" }]));
    h.expireDecisions.mockResolvedValue(2);

    const r = await tickSchedules(new Date("2026-09-22T20:00:00Z"));
    expect(r.enqueued).toEqual(
      expect.arrayContaining([
        { agentId: "hourly-agent", cadence: "hourly", bucket: "2026-09-22T20" },
        { agentId: "daily-agent", cadence: "daily", bucket: "2026-09-22" },
      ]),
    );
    expect(r.enqueued).toHaveLength(2);
    expect(h.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ agentId: "daily-agent", kind: "schedule", triggerKey: "daily:2026-09-22" }));
    expect(r.expiredDecisions).toBe(2);
    expect(h.requeueStaleJobs).toHaveBeenCalled();
  });
});
