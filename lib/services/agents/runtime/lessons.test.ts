/**
 * The learning loop. The property under test is that a lesson is inert
 * until a person makes it active, and that nothing about a lesson can
 * reach the rules enforced in code.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentLesson: {
      findMany: h.findMany,
      findFirst: h.findFirst,
      create: h.create,
      update: h.update,
      updateMany: h.updateMany,
    },
  },
}));

import { decideLesson, loadLessons, proposeLesson, renderLessons, retireLesson } from "./lessons";

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.updateMany.mockResolvedValue({ count: 0 });
  h.update.mockResolvedValue({});
});

describe("loadLessons", () => {
  it("loads only active lessons for that agent and counts the use", async () => {
    h.findMany.mockResolvedValue([
      { id: "l1", agentId: "opener", scope: "first touch to a Rezdy operator", lesson: "Lead with their own system.", timesApplied: 3 },
    ]);
    const out = await loadLessons("opener");
    expect(out).toHaveLength(1);
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agentId: "opener", status: "ACTIVE" }, take: 12 }),
    );
    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["l1"] } }, data: { timesApplied: { increment: 1 } } }),
    );
  });

  it("touches nothing when an agent has no lessons", async () => {
    h.findMany.mockResolvedValue([]);
    expect(await loadLessons("scout")).toEqual([]);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

describe("renderLessons", () => {
  it("renders nothing at all when there are none, so the task is unchanged", () => {
    expect(renderLessons([])).toBe("");
  });

  it("frames lessons as observations and states that a rule always wins", () => {
    const text = renderLessons([
      { id: "l1", agentId: "opener", scope: "writing a first touch", lesson: "Name their own booking system in the first line.", timesApplied: 1 },
    ]);
    expect(text).toContain("When writing a first touch: Name their own booking system");
    expect(text).toMatch(/observations from evidence, not rules/);
    expect(text).toMatch(/the rule wins and the lesson is wrong/);
  });
});

describe("proposeLesson", () => {
  it("creates a proposal that is inactive by default", async () => {
    h.findFirst.mockResolvedValue(null);
    h.create.mockResolvedValue({ id: "l_new" });
    const r = await proposeLesson({
      agentId: "opener", scope: "first touch", lesson: "Lead with their system.",
      evidence: { observationCount: 4 }, proposedByRunId: "run_1",
    });
    expect(r).toEqual({ lessonId: "l_new", duplicate: false });
    const data = h.create.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.proposedByRunId).toBe("run_1");
  });

  it("does not propose the same thing twice for one scope", async () => {
    h.findFirst.mockResolvedValue({ id: "l_existing" });
    const r = await proposeLesson({
      agentId: "opener", scope: "first touch", lesson: "Something similar.",
      evidence: {}, proposedByRunId: "run_2",
    });
    expect(r).toEqual({ lessonId: "l_existing", duplicate: true });
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("decideLesson and retireLesson", () => {
  it("activates on accept and rejects otherwise, recording who decided", async () => {
    await decideLesson({ id: "l1", accept: true, by: "tony", now: new Date("2026-09-21T00:00:00Z") });
    expect(h.update.mock.calls[0][0].data).toMatchObject({ status: "ACTIVE", decidedBy: "tony" });

    await decideLesson({ id: "l2", accept: false, by: "tony" });
    expect(h.update.mock.calls[1][0].data.status).toBe("REJECTED");
  });

  it("retires with a reason so a retired lesson is auditable", async () => {
    await retireLesson({ id: "l1", reason: "Loaded 90 times and never relevant." });
    expect(h.update.mock.calls[0][0].data).toMatchObject({ status: "RETIRED", retiredReason: expect.stringContaining("never relevant") });
  });
});
