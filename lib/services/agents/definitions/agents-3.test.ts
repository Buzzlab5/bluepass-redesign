/**
 * Agents 09 and 10. The two guardrails under test here are the ones that
 * cost a relationship rather than a sale: never describing inventory that
 * is not bookable, and never reassuring an operator about money the record
 * cannot actually account for.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  directiveFindMany: vi.fn(),
  lessonFindMany: vi.fn(),
  lessonUpdateMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  partnerProfileFindMany: vi.fn(),
  partnerProfileFindUnique: vi.fn(),
  partnerProfileUpdate: vi.fn(),
  referralPartnerCreate: vi.fn(),
  referralLinkFindUnique: vi.fn(),
  referralLinkCreate: vi.fn(),
  referralLinkFindMany: vi.fn(),
  listingFindMany: vi.fn(),
  opProfileFindUnique: vi.fn(),
  opProfileFindMany: vi.fn(),
  requestDecision: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentDirective: { findMany: h.directiveFindMany },
    agentLesson: { findMany: h.lessonFindMany, updateMany: h.lessonUpdateMany },
    agentRun: { create: h.runCreate, update: h.runUpdate, count: h.runCount },
    partnerProfile: { findMany: h.partnerProfileFindMany, findUnique: h.partnerProfileFindUnique, update: h.partnerProfileUpdate },
    referralPartner: { create: h.referralPartnerCreate },
    referralLink: { findUnique: h.referralLinkFindUnique, create: h.referralLinkCreate, findMany: h.referralLinkFindMany },
    operatorListing: { findMany: h.listingFindMany },
    operatorProfile: { findUnique: h.opProfileFindUnique, findMany: h.opProfileFindMany },
  },
}));
vi.mock("../runtime/decisions", () => ({ requestDecision: h.requestDecision }));
vi.mock("../tools/dispatch", async (orig) => {
  const actual = await orig<typeof import("../tools/dispatch")>();
  return { ...actual, dispatch: h.dispatch, dispatcherWired: () => true };
});

import { runJob } from "../runtime/runner";
import { ScriptedModel, type ScriptStep } from "../runtime/model";
import { registerAgent, resetRegistryForTests } from "../runtime/registry";
import { partnerDeskAgent } from "./partner-desk";
import { operatorSupportAgent } from "./operator-support";
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
  h.lessonFindMany.mockResolvedValue([]);
  h.lessonUpdateMany.mockResolvedValue({ count: 0 });
  h.runCreate.mockResolvedValue({ id: "run_1" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.requestDecision.mockResolvedValue({ decisionId: "dec_1", existing: false });
  h.dispatch.mockResolvedValue({ status: "sent", providerId: "m1" });
  h.listingFindMany.mockResolvedValue([]);
  h.referralLinkFindMany.mockResolvedValue([]);
});

// ─── 09 Partner desk ─────────────────────────────────────────────────────────

describe("Partner desk", () => {
  it("tells the agent there is nothing to sell when nothing is bookable", async () => {
    h.listingFindMany.mockResolvedValue([]);
    await run(partnerDeskAgent, {}, [{ tool: "what_is_bookable", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/Nothing is bookable right now/);
    expect(out).toMatch(/Do not tell a partner there is inventory/);
  });

  it("reports the real catalogue, grouped, and nothing beyond it", async () => {
    h.listingFindMany.mockResolvedValue([
      { region: "QLD", category: "dive", title: "Outer reef" },
      { region: "QLD", category: "dive", title: "Ribbon reefs" },
      { region: "QLD", category: "snorkel", title: "Green Island" },
      { region: "WA", category: "dive", title: "Ningaloo" },
    ]);
    await run(partnerDeskAgent, {}, [{ tool: "what_is_bookable", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/4 bookable listings today/);
    expect(out).toMatch(/QLD: 2 dive, 1 snorkel/);
    expect(out).toMatch(/WA: 1 dive/);
    expect(out).toMatch(/Describe this and nothing more/);
  });

  it("issues a link, creates the partner record and approves the profile", async () => {
    h.partnerProfileFindUnique.mockResolvedValue({
      id: "pp_1", status: "PENDING_REVIEW", handle: "bluehorizon", partnerCategory: "DIVE_SHOP",
      referralPartnerId: null, account: { email: "dive@bh.com", displayName: "Blue Horizon Dive" },
    });
    h.referralLinkFindUnique.mockResolvedValue(null);
    h.referralPartnerCreate.mockResolvedValue({ id: "rp_1" });
    h.referralLinkCreate.mockResolvedValue({ id: "rl_1", code: "blue-horizon-dive" });
    h.partnerProfileUpdate.mockResolvedValue({});

    const r = await run(partnerDeskAgent, {}, [
      { tool: "issue_referral_link", input: { profile_id: "pp_1", code: "blue-horizon-dive" } },
    ]);
    expect(h.referralPartnerCreate).toHaveBeenCalled();
    expect(h.partnerProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "APPROVED", referralPartnerId: "rp_1" } }),
    );
    expect(toolResults()[0].result).toMatch(/never what it pays/);
    expect((r.outcome.issued as unknown[]).length).toBe(1);
  });

  it("refuses a code somebody already has", async () => {
    h.partnerProfileFindUnique.mockResolvedValue({ id: "pp_1", status: "PENDING_REVIEW", referralPartnerId: null, account: { email: "a@b.com", displayName: "A" } });
    h.referralLinkFindUnique.mockResolvedValue({ id: "rl_existing" });
    await run(partnerDeskAgent, {}, [
      { tool: "issue_referral_link", input: { profile_id: "pp_1", code: "taken-code" } },
    ]);
    expect(toolResults()[0].result).toMatch(/already in use/);
    expect(h.referralLinkCreate).not.toHaveBeenCalled();
  });

  it("refuses a code that is not readable, before it reaches the database", async () => {
    await run(partnerDeskAgent, {}, [
      { tool: "issue_referral_link", input: { profile_id: "pp_1", code: "Xk_92!!" } },
    ]);
    expect(toolResults()[0].result).toMatch(/INVALID_INPUT/);
    expect(h.partnerProfileFindUnique).not.toHaveBeenCalled();
  });

  it("names a dormant link as BluePass's failure, not the partner's", async () => {
    h.referralLinkFindMany.mockResolvedValue([
      { id: "rl_1", code: "used", createdAt: new Date(now.getTime() - 60 * 86_400_000), partner: { name: "Active Co", email: null }, _count: { clicks: 14 } },
      { id: "rl_2", code: "never", createdAt: new Date(now.getTime() - 60 * 86_400_000), partner: { name: "Quiet Co", email: null }, _count: { clicks: 0 } },
    ]);
    const r = await run(partnerDeskAgent, {}, [{ tool: "read_link_performance", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/used · Active Co · 14 clicks/);
    expect(out).toMatch(/NEVER USED/);
    expect(out).toMatch(/Both are BluePass's problem, not theirs/);
    expect(r.outcome.dormant).toBe(1);
  });

  it("will not message a partner on unverified copy", async () => {
    h.partnerProfileFindUnique.mockResolvedValue({ id: "pp_1", account: { email: "a@b.com", displayName: "A" } });
    await run(partnerDeskAgent, {}, [
      { tool: "message_partner", input: { profile_id: "pp_1", body: "You will earn a great commission with us, easily 20% on every booking." } },
    ]);
    expect(toolResults()[0].result).toMatch(/Refused: the copy rules have not passed/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});

// ─── 10 Operator support ─────────────────────────────────────────────────────

describe("Operator support", () => {
  const profile = {
    id: "op_1", companyName: "Cairns Reef Dive", status: "LIVE", websiteUrl: "https://x.com",
    claimedAt: now, country: "AU", payoutMethod: "STRIPE_CONNECT",
    stripeConnectAccountId: "acct_1", stripeChargesEnabled: true, stripePayoutsEnabled: false,
    payoutContactEmail: "pay@x.com", cancellationPolicyTiers: null,
    account: { email: "hi@x.com", displayName: "Sam" },
    pmsReadiness: { platform: "REZDY", status: "CONNECTED", notes: "connected 18 Sep", updatedAt: now },
    listings: [
      { title: "Outer reef day trip", status: "LIVE", priceSignal: "From AUD 189", externalProductId: "P1" },
      { title: "Night dive", status: "DRAFT", priceSignal: null, externalProductId: null },
    ],
  };

  it("states plainly that money is not in this record", async () => {
    h.opProfileFindUnique.mockResolvedValue(profile);
    await run(operatorSupportAgent, { entityId: "op_1", message: "Where is my money?" }, [
      { tool: "read_operator_standing", input: { profile_id: "op_1" } },
    ]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/NOT IN THIS RECORD: bookings taken, money held, money paid/);
    expect(out).toMatch(/Say so rather than guessing/);
    expect(out).toMatch(/payouts OFF/);
    expect(out).toMatch(/platform default applies/);
  });

  it("escalates a money question with a short deadline instead of reassuring", async () => {
    h.opProfileFindUnique.mockResolvedValue(profile);
    const r = await run(operatorSupportAgent, { entityId: "op_1", message: "We took a booking three weeks ago and nothing has landed." }, [
      { tool: "read_operator_standing", input: { profile_id: "op_1" } },
      { tool: "escalate_to_person", input: { profile_id: "op_1", who: "Cairns Reef Dive", what_they_asked: "Where is the money from a booking three weeks ago.", why_you_cannot_answer: "The operator record holds payout setup but no balance or booking history.", urgency: "high" } },
    ]);
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: expect.objectContaining({ kind: "operator.needs_person", assignee: "kirby" }),
        req: expect.objectContaining({ ttlHours: 8 }),
      }),
    );
    expect(toolResults()[1].result).toMatch(/do not guess at the answer/);
    expect(r.outcome.escalated).toBe(true);
  });

  it("will not reply on unverified copy", async () => {
    h.opProfileFindUnique.mockResolvedValue(profile);
    await run(operatorSupportAgent, { entityId: "op_1", message: "hi" }, [
      { tool: "answer_operator", input: { profile_id: "op_1", channel: "email", body: "All good, your payout is on the way." } },
    ]);
    expect(toolResults()[0].result).toMatch(/Refused: the copy rules have not passed/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("answers what the record does support", async () => {
    h.opProfileFindUnique.mockResolvedValue(profile);
    const reply = "Your night dive listing is still in draft and has no price on it, which is why it is not showing. Add a price and publish it and it will appear. Your Rezdy connection is through and your reef day trip is live.";
    await run(operatorSupportAgent, { entityId: "op_1", message: "Why can't I see my night dive on the site?" }, [
      { tool: "read_operator_standing", input: { profile_id: "op_1" } },
      { tool: "verify_outbound", input: { text: reply, audience: "operator" } },
      { tool: "answer_operator", input: { profile_id: "op_1", channel: "email", body: reply } },
    ]);
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ to: "hi@x.com" }));
  });

  it("runs the monthly statement path when the clock triggers it", async () => {
    h.opProfileFindMany.mockResolvedValue([
      { id: "op_1", companyName: "Cairns Reef Dive", pmsReadiness: { platform: "REZDY", status: "SYNCED" }, listings: [{ status: "LIVE" }], stripePayoutsEnabled: false },
    ]);
    const r = await run(operatorSupportAgent, { cadence: "monthly" }, [
      { tool: "list_operators_for_statement", input: {} },
    ]);
    expect(r.port.calls[0].user).toMatch(/standing note/);
    expect(toolResults()[0].result).toMatch(/payouts NOT SET UP/);
  });

  it("does nothing when there is no message to answer", async () => {
    const r = await run(operatorSupportAgent, { entityId: "op_1" }, []);
    expect(r.status).toBe("SKIPPED");
    expect(r.port.calls).toHaveLength(0);
  });
});
