/**
 * The Content studio. The guardrail under test is the honesty gate: an
 * article may not invite a reader to book something BluePass cannot sell,
 * and a published page is the one place that mistake is permanent.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  directiveFindMany: vi.fn(),
  lessonFindMany: vi.fn(),
  lessonUpdateMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  listingFindMany: vi.fn(),
  listingCount: vi.fn(),
  postFindMany: vi.fn(),
  postFindFirst: vi.fn(),
  postCreate: vi.fn(),
  categoryFindMany: vi.fn(),
  requestDecision: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentDirective: { findMany: h.directiveFindMany },
    agentLesson: { findMany: h.lessonFindMany, updateMany: h.lessonUpdateMany },
    agentRun: { create: h.runCreate, update: h.runUpdate, count: h.runCount },
    operatorListing: { findMany: h.listingFindMany, count: h.listingCount },
    blogPost: { findMany: h.postFindMany, findFirst: h.postFindFirst, create: h.postCreate },
    blogCategory: { findMany: h.categoryFindMany },
  },
}));
vi.mock("../runtime/decisions", () => ({ requestDecision: h.requestDecision }));

import { runJob } from "../runtime/runner";
import { ScriptedModel, type ScriptStep } from "../runtime/model";
import { registerAgent, resetRegistryForTests } from "../runtime/registry";
import { contentStudioAgent, CONTENT_STUDIO_ID } from "./content-studio";
import type { JobPayload } from "../runtime/types";

const now = new Date("2026-09-21T06:00:00Z");
const BODY = Array.from({ length: 520 }, (_, i) => `word${i}`).join(" ");

function run(payload: JobPayload, script: ScriptStep[]) {
  resetRegistryForTests();
  registerAgent(contentStudioAgent);
  const port = new ScriptedModel(script);
  const job = {
    id: "job_1", agentId: CONTENT_STUDIO_ID, kind: "manual", triggerKey: "manual:1", payload,
    status: "RUNNING", attempts: 1, maxAttempts: 3, runAfter: now, lockedAt: now,
    lastError: null, runId: null, createdAt: now, updatedAt: now,
  };
  return runJob(job as never, { now, port }).then((r) => ({ ...r, port }));
}

function toolResults(): { name: string; result: string }[] {
  return h.runUpdate.mock.calls.at(-1)![0].data.toolCalls ?? [];
}

function draftInput(over: Record<string, unknown> = {}) {
  return {
    title: "When to dive the Great Barrier Reef",
    slug: "when-to-dive-the-great-barrier-reef",
    focus_keyword: "best time to dive great barrier reef",
    body_markdown: BODY,
    excerpt: "The water is warmest from November, but visibility peaks in the dry season. Here is how the seasons actually trade off.",
    meta_description: "When to dive the Great Barrier Reef, by season: water temperature, visibility, rainfall and what you are likely to see.",
    mentions_bookable_trips: false,
    ...over,
  };
}

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.directiveFindMany.mockResolvedValue([]);
  h.lessonFindMany.mockResolvedValue([]);
  h.lessonUpdateMany.mockResolvedValue({ count: 0 });
  h.runCreate.mockResolvedValue({ id: "run_1" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.listingFindMany.mockResolvedValue([]);
  h.postFindMany.mockResolvedValue([]);
  h.postFindFirst.mockResolvedValue(null);
  h.categoryFindMany.mockResolvedValue([]);
  h.postCreate.mockResolvedValue({ id: "post_1", slug: "when-to-dive-the-great-barrier-reef" });
  h.listingCount.mockResolvedValue(0);
  h.requestDecision.mockResolvedValue({ decisionId: "dec_a", existing: false });
});

describe("Content studio", () => {
  it("tells the agent to invite nobody when nothing is bookable", async () => {
    h.listingFindMany.mockResolvedValue([]);
    await run({}, [{ tool: "read_what_exists", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/Nothing is bookable yet/);
    expect(out).toMatch(/No call to action that says book/);
  });

  it("refuses an article that invites a booking when there is nothing to book", async () => {
    h.listingCount.mockResolvedValue(0);
    await run({}, [
      { tool: "verify_outbound", input: { text: BODY, audience: "customer" } },
      { tool: "draft_article", input: draftInput({ mentions_bookable_trips: true }) },
    ]);
    expect(toolResults()[1].result).toMatch(/you marked this as inviting the reader to book, and nothing is bookable/);
    expect(h.postCreate).not.toHaveBeenCalled();
  });

  it("allows a booking invitation once something is live", async () => {
    h.listingCount.mockResolvedValue(3);
    await run({}, [
      { tool: "verify_outbound", input: { text: BODY, audience: "customer" } },
      { tool: "draft_article", input: draftInput({ mentions_bookable_trips: true }) },
    ]);
    expect(h.postCreate).toHaveBeenCalled();
  });

  it("saves as a draft, never published, and flags it to be read", async () => {
    const r = await run({}, [
      { tool: "verify_outbound", input: { text: BODY, audience: "customer" } },
      { tool: "draft_article", input: draftInput() },
    ]);
    const data = h.postCreate.mock.calls[0][0].data;
    expect(data.status).toBe("DRAFT");
    expect(data.wordCount).toBe(520);
    expect(data.readingMinutes).toBe(2);
    expect(toolResults()[1].result).toMatch(/you cannot publish it/);
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ gate: expect.objectContaining({ kind: "article.drafted" }) }),
    );
    expect((r.outcome.drafted as unknown[]).length).toBe(1);
  });

  it("refuses a second page competing for a keyword BluePass already ranks for", async () => {
    h.postFindFirst.mockResolvedValue({
      slug: "diving-the-gbr-by-season", title: "Diving the GBR by season",
      focusKeyword: "best time to dive great barrier reef",
    });
    await run({}, [
      { tool: "verify_outbound", input: { text: BODY, audience: "customer" } },
      { tool: "draft_article", input: draftInput() },
    ]);
    expect(toolResults()[1].result).toMatch(/split their own ranking/);
    expect(h.postCreate).not.toHaveBeenCalled();
  });

  it("refuses an article too thin to be worth reading", async () => {
    await run({}, [
      { tool: "verify_outbound", input: { text: "short", audience: "customer" } },
      { tool: "draft_article", input: draftInput({ body_markdown: Array.from({ length: 420 }, (_, i) => `w${i}`).join(" ") }) },
    ]);
    expect(toolResults()[1].result).toMatch(/will not rank and is not worth a reader's time/);
    expect(h.postCreate).not.toHaveBeenCalled();
  });

  it("refuses to draft anything the copy rules have not passed", async () => {
    await run({}, [{ tool: "draft_article", input: draftInput() }]);
    expect(toolResults()[0].result).toMatch(/Refused: the copy rules have not passed/);
    expect(h.postCreate).not.toHaveBeenCalled();
  });

  it("lists what is already written so it does not repeat itself", async () => {
    h.postFindMany.mockResolvedValue([
      { title: "Ningaloo whale sharks", slug: "ningaloo-whale-sharks", focusKeyword: "swim with whale sharks ningaloo", status: "PUBLISHED", tags: [] },
    ]);
    h.listingFindMany.mockResolvedValue([{ title: "Outer reef", region: "QLD", category: "dive", description: "x" }]);
    const r = await run({}, [{ tool: "read_what_exists", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/do not duplicate a focus keyword/);
    expect(out).toMatch(/swim with whale sharks ningaloo/);
    expect(r.outcome.liveListings).toBe(1);
  });
});
