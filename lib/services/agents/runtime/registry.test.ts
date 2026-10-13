import { describe, it, expect, beforeEach } from "vitest";
import {
  agentsForCadence,
  agentsForEvent,
  getAgent,
  matchesPattern,
  registerAgent,
  resetRegistryForTests,
} from "./registry";
import type { AgentDefinition, TriggerSpec } from "./types";

function def(id: string, triggers: TriggerSpec[], tools: AgentDefinition["tools"] = []): AgentDefinition {
  return {
    id,
    name: id,
    desk: "company",
    plane: "product",
    wave: 1,
    modelTier: "classification",
    persona: "test persona",
    triggers,
    tools,
    gates: [],
    budget: { maxRunsPerDay: 10, maxTokensPerRun: 1000, maxIterations: 3 },
    buildTask: async () => ({ task: "do the thing" }),
  };
}

beforeEach(() => resetRegistryForTests());

describe("matchesPattern", () => {
  it("matches exact actions and prefix wildcards only", () => {
    expect(matchesPattern("booking.created", "booking.created")).toBe(true);
    expect(matchesPattern("booking.created", "booking.createdX")).toBe(false);
    expect(matchesPattern("booking.state_transition.*", "booking.state_transition.QUOTED_to_CONFIRMED")).toBe(true);
    expect(matchesPattern("booking.*", "payment.received")).toBe(false);
  });
});

describe("registry", () => {
  it("routes events and cadences to the subscribed agents", () => {
    registerAgent(def("a", [{ type: "event", pattern: "booking.*" }, { type: "schedule", cadence: "daily" }]));
    registerAgent(def("b", [{ type: "event", pattern: "claim.accepted" }]));
    registerAgent(def("c", [{ type: "manual" }]));

    expect(agentsForEvent("booking.created").map((a) => a.id)).toEqual(["a"]);
    expect(agentsForEvent("claim.accepted").map((a) => a.id)).toEqual(["b"]);
    expect(agentsForEvent("nothing").map((a) => a.id)).toEqual([]);
    expect(agentsForCadence("daily").map((a) => a.id)).toEqual(["a"]);
    expect(agentsForCadence("hourly")).toEqual([]);
    expect(getAgent("c").plane).toBe("product");
  });

  it("rejects duplicate agent ids and duplicate tool names", () => {
    registerAgent(def("dup", []));
    expect(() => registerAgent(def("dup", []))).toThrow(/already registered/);
    const tool = { name: "t", description: "d", schema: {} as never, run: async () => "ok" };
    expect(() => registerAgent(def("twotools", [], [tool, tool]))).toThrow(/twice/);
    expect(() => getAgent("missing")).toThrow(/Unknown agent/);
  });
});
