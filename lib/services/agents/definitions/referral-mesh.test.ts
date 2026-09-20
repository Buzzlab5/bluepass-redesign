/**
 * The Referral mesh. What is asserted is that it will not put a second
 * operator in front of a traveller who is already sorted, and will not
 * stretch a match to fill a gap.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  lessonFindMany: vi.fn(),
  lessonUpdateMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  inquiryFindMany: vi.fn(),
  inquiryFindUnique: vi.fn(),
  inquiryEventCreate: vi.fn(),
  listingFindMany: vi.fn(),
  opProfileFindUnique: vi.fn(),
  requestDecision: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentLesson: { findMany: h.lessonFindMany, updateMany: h.lessonUpdateMany },
    agentRun: { create: h.runCreate, update: h.runUpdate, count: h.runCount },
    bookingInquiry: { findMany: h.inquiryFindMany, findUnique: h.inquiryFindUnique },
    bookingInquiryEvent: { create: h.inquiryEventCreate },
    operatorListing: { findMany: h.listingFindMany },
    operatorProfile: { findUnique: h.opProfileFindUnique },
  },
}));
vi.mock("../runtime/decisions", () => ({ requestDecision: h.requestDecision }));

import { runJob } from "../runtime/runner";
import { ScriptedModel, type ScriptStep } from "../runtime/model";
import { registerAgent, resetRegistryForTests } from "../runtime/registry";
import { referralMeshAgent, REFERRAL_MESH_ID } from "./referral-mesh";
import type { JobPayload } from "../runtime/types";

const now = new Date("2026-09-21T06:00:00Z");

function run(payload: JobPayload, script: ScriptStep[]) {
  resetRegistryForTests();
  registerAgent(referralMeshAgent);
  const port = new ScriptedModel(script);
  const job = {
    id: "job_1", agentId: REFERRAL_MESH_ID, kind: "manual", triggerKey: "manual:1", payload,
    status: "RUNNING", attempts: 1, maxAttempts: 3, runAfter: now, lockedAt: now,
    lastError: null, runId: null, createdAt: now, updatedAt: now,
  };
  return runJob(job as never, { now, port }).then((r) => ({ ...r, port }));
}

function toolResults(): { name: string; result: string }[] {
  return h.runUpdate.mock.calls.at(-1)![0].data.toolCalls ?? [];
}

const liveTarget = { id: "opp_2", companyName: "Ribbon Reef Charters", status: "LIVE" };

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.lessonFindMany.mockResolvedValue([]);
  h.lessonUpdateMany.mockResolvedValue({ count: 0 });
  h.runCreate.mockResolvedValue({ id: "run_1" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.inquiryEventCreate.mockResolvedValue({});
  h.requestDecision.mockResolvedValue({ decisionId: "dec_r", existing: false });
  h.opProfileFindUnique.mockResolvedValue(liveTarget);
});

describe("Referral mesh", () => {
  it("finds declined and long-unanswered enquiries, and says how long they have waited", async () => {
    h.inquiryFindMany.mockResolvedValue([
      { id: "iq_1", status: "OPERATOR_DECLINED", destination: "Komodo", tripType: "liveaboard", dateWindow: "June", guests: 2, certificationLevel: "AOW", budget: null, notes: null, selectedYachtName: null, operatorId: "op_1", updatedAt: now, createdAt: now, operator: { id: "op_1", name: "First Boat" } },
      { id: "iq_2", status: "OPERATOR_PENDING", destination: "Cairns", tripType: "day dive", dateWindow: null, guests: 4, certificationLevel: null, budget: null, notes: null, selectedYachtName: null, operatorId: "op_9", updatedAt: new Date(now.getTime() - 72 * 3_600_000), createdAt: now, operator: { id: "op_9", name: "Quiet Co" } },
    ]);
    const r = await run({}, [{ tool: "find_stranded_inquiries", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/OPERATOR_DECLINED/);
    expect(out).toMatch(/unanswered 72h/);
    expect(r.outcome.stranded).toBe(2);
  });

  it("refuses to stretch a match when nothing fits, and says why", async () => {
    h.listingFindMany.mockResolvedValue([]);
    await run({}, [{ tool: "find_candidate_operators", input: { region: "Komodo", category: "liveaboard" } }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/No live, bookable operator in Komodo/);
    expect(out).toMatch(/a bad referral is worse than none/);
  });

  it("excludes the operator who already declined", async () => {
    h.listingFindMany.mockResolvedValue([
      { id: "l1", title: "Outer reef", region: "QLD", category: "dive", maxGuests: 12, priceSignal: "From AUD 189", operatorProfile: { id: "opp_1", companyName: "First Boat", claimedOperatorSlug: "first", status: "LIVE" } },
      { id: "l2", title: "Ribbon reefs", region: "QLD", category: "dive", maxGuests: 10, priceSignal: null, operatorProfile: { id: "opp_2", companyName: "Ribbon Reef Charters", claimedOperatorSlug: "ribbon", status: "LIVE" } },
    ]);
    const r = await run({}, [
      { tool: "find_candidate_operators", input: { region: "QLD", category: "dive", exclude_operator_id: "opp_1" } },
    ]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/Ribbon Reef Charters/);
    expect(out).not.toMatch(/operator_profile_id: opp_1/);
    expect(r.outcome.candidates).toBe(1);
  });

  it("records a match but sends nothing, leaving the dispatch to a person", async () => {
    h.inquiryFindUnique.mockResolvedValue({ id: "iq_1", status: "OPERATOR_DECLINED", bookingId: null, operatorId: "op_1", destination: "Cairns" });
    const r = await run({}, [
      { tool: "refer_inquiry", input: { inquiry_id: "iq_1", to_operator_profile_id: "opp_2", why_this_match: "They run the same two-tank outer reef trip she asked about and take up to twelve." } },
    ]);
    expect(h.inquiryEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: "OPERATOR_DECLINED",
          toStatus: "READY_TO_DISPATCH",
          actorType: "SYSTEM",
          payload: expect.objectContaining({ event: "agent.referral_proposed" }),
        }),
      }),
    );
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: expect.objectContaining({ kind: "referral.proposed", assignee: "kirby" }),
        req: expect.objectContaining({ options: ["send it", "do not"] }),
      }),
    );
    expect(toolResults()[0].result).toMatch(/Nothing has been sent yet/);
    expect((r.outcome.referred as unknown[]).length).toBe(1);
  });

  it("will not put a second operator in front of a traveller who is already sorted", async () => {
    for (const [state, pattern] of [
      [{ status: "OPERATOR_DECLINED", bookingId: "bk_1" }, /already became a booking/],
      [{ status: "OPERATOR_ACCEPTED", bookingId: null }, /an operator has accepted this/i],
      [{ status: "COUNTER_OFFERED", bookingId: null }, /live negotiation/],
    ] as const) {
      h.inquiryFindUnique.mockResolvedValue({ id: "iq_1", operatorId: "op_1", destination: "Cairns", ...state });
      await run({}, [
        { tool: "refer_inquiry", input: { inquiry_id: "iq_1", to_operator_profile_id: "opp_2", why_this_match: "x" } },
      ]);
      expect(toolResults()[0].result).toMatch(pattern);
      expect(h.inquiryEventCreate).not.toHaveBeenCalled();
    }
  });

  it("will not refer to an operator who is not live", async () => {
    h.inquiryFindUnique.mockResolvedValue({ id: "iq_1", status: "OPERATOR_DECLINED", bookingId: null, operatorId: "op_1", destination: "Cairns" });
    h.opProfileFindUnique.mockResolvedValue({ id: "opp_3", companyName: "Not Yet Co", status: "PENDING_REVIEW" });
    await run({}, [
      { tool: "refer_inquiry", input: { inquiry_id: "iq_1", to_operator_profile_id: "opp_3", why_this_match: "x" } },
    ]);
    expect(toolResults()[0].result).toMatch(/is PENDING_REVIEW, not live/);
    expect(h.inquiryEventCreate).not.toHaveBeenCalled();
  });

  it("treats an unreferrable enquiry as a supply gap worth knowing about", async () => {
    h.inquiryFindUnique.mockResolvedValue({ status: "OPERATOR_DECLINED" });
    const r = await run({}, [
      { tool: "record_unreferrable", input: { inquiry_id: "iq_1", why: "Wanted a Raja Ampat liveaboard in October; BluePass has no live Indonesian operator." } },
    ]);
    expect(h.inquiryEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: "OPERATOR_DECLINED",
          toStatus: "OPERATOR_DECLINED",
          actorType: "SYSTEM",
          payload: expect.objectContaining({ event: "agent.unreferrable" }),
        }),
      }),
    );
    expect(toolResults()[0].result).toMatch(/the Scout's next region/);
    expect((r.outcome.gaps as unknown[]).length).toBe(1);
  });
});
