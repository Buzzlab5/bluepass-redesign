/**
 * The four levers and the floor under them. The property under test is that
 * a directive can only ever make an agent do less, and can never reach a
 * rule, a gate, a manual-only channel or money.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentDirective: { create: h.create, update: h.update, updateMany: h.updateMany, findMany: h.findMany },
  },
}));

import {
  checkInstruction,
  expireDirectives,
  issueDirective,
  renderDirectives,
  resolveForAgent,
  revokeDirective,
} from "./directives";

const now = new Date("2026-09-21T06:00:00Z");

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.create.mockResolvedValue({ id: "d_1" });
  h.update.mockResolvedValue({});
  h.updateMany.mockResolvedValue({ count: 0 });
  h.findMany.mockResolvedValue([]);
});

describe("the floor", () => {
  it("refuses an instruction that would switch off the copy rules", async () => {
    const r = await issueDirective({
      scope: { type: "agent", id: "opener" },
      instruction: "Skip the copy rules for operators we already know.",
      levers: {},
      issuedBy: "supply-manager",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusedBecause).toMatch(/the copy rules/);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("refuses an instruction that would take a decision away from a person", () => {
    const r = checkInstruction("Approve the claims on my behalf so I don't have to.", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusedBecause).toMatch(/belongs to a person/);
  });

  it("refuses removing a gate, cold outreach on a manual-only channel, and moving money", () => {
    for (const [instruction, why] of [
      ["No need for approval on listing demotions.", /a gate/],
      ["Start cold DM on Instagram for the Cairns leads.", /manual-only channel/],
      ["Send the money to the operator as soon as the trip runs.", /moving money/],
    ] as const) {
      const r = checkInstruction(instruction, {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusedBecause).toMatch(why);
    }
  });

  it("refuses a pace that would raise a ceiling rather than lower it", () => {
    const r = checkInstruction("Run the opener harder.", { pace: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusedBecause).toMatch(/cannot raise the ceiling/);
  });

  it("says nothing was stored when it refuses, so an unobeyed order is never silent", () => {
    const r = checkInstruction("Disable verification on short drafts.", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusedBecause).toMatch(/has not been stored/);
  });
});

describe("issuing", () => {
  it("stores a scope directive with the instruction kept verbatim", async () => {
    const r = await issueDirective({
      scope: { type: "agent", id: "scout" },
      instruction: "Leave Indonesia alone until the payout rail is solved. Push everything at Queensland.",
      levers: { region: "Queensland" },
      issuedBy: "supply-manager",
      expiresAt: null,
    });
    expect(r).toEqual({ ok: true, directiveId: "d_1" });
    const data = h.create.mock.calls[0][0].data;
    expect(data.instruction).toMatch(/Leave Indonesia alone/);
    expect(data.levers).toEqual({ region: "Queensland" });
    expect(data.scopeType).toBe("agent");
  });
});

describe("resolving", () => {
  it("combines an agent's own directives with its manager's", async () => {
    h.findMany.mockResolvedValue([
      { instruction: "Queensland only.", levers: { region: "Queensland" } },
      { instruction: "Dive trips first.", levers: { category: "dive" } },
    ]);
    const r = await resolveForAgent({ agentId: "scout", managerId: "supply-manager" });
    expect(r.levers).toEqual({ region: "Queensland", category: "dive" });
    expect(r.instructions).toHaveLength(2);
    expect(h.findMany.mock.calls[0][0].where.OR).toEqual([
      { scopeType: "agent", scopeId: "scout" },
      { scopeType: "manager", scopeId: "supply-manager" },
    ]);
  });

  it("takes the slowest pace when two directives disagree, never the faster", async () => {
    h.findMany.mockResolvedValue([
      { instruction: "Half speed.", levers: { pace: 0.5 } },
      { instruction: "Quarter speed while we check something.", levers: { pace: 0.25 } },
    ]);
    const r = await resolveForAgent({ agentId: "opener" });
    expect(r.levers.pace).toBe(0.25);
  });

  it("lets a pause win over everything else", async () => {
    h.findMany.mockResolvedValue([
      { instruction: "Queensland only.", levers: { region: "Queensland" } },
      { instruction: "Stop until we sort the sender.", levers: { paused: true } },
    ]);
    const r = await resolveForAgent({ agentId: "opener" });
    expect(r.levers.paused).toBe(true);
  });

  it("returns nothing when an agent is under no direction", async () => {
    h.findMany.mockResolvedValue([]);
    const r = await resolveForAgent({ agentId: "scout" });
    expect(r.levers).toEqual({});
    expect(renderDirectives(r)).toBe("");
  });
});

describe("rendering", () => {
  it("states the direction and that a rule still wins", () => {
    const text = renderDirectives({
      levers: { region: "Queensland" },
      instructions: ["Leave Indonesia alone until the payout rail is solved."],
    });
    expect(text).toMatch(/Leave Indonesia alone/);
    expect(text).toMatch(/Scope: Queensland only/);
    expect(text).toMatch(/cannot loosen any rule, and if one appears to, the rule wins/);
  });
});

describe("lifecycle", () => {
  it("revokes with who did it", async () => {
    await revokeDirective({ id: "d_1", by: "supply-manager", now });
    expect(h.update.mock.calls[0][0].data).toMatchObject({ status: "REVOKED", revokedBy: "supply-manager" });
  });

  it("expires only the ones that were given a deadline", async () => {
    h.updateMany.mockResolvedValue({ count: 2 });
    expect(await expireDirectives(now)).toBe(2);
    expect(h.updateMany.mock.calls[0][0].where).toMatchObject({
      status: "ACTIVE",
      expiresAt: { not: null, lte: now },
    });
  });
});
