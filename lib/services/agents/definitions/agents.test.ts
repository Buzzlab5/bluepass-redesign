/**
 * The five Wave 1 agents, tested through the real runner with a scripted
 * model. What is asserted here is mostly what each agent REFUSES to do:
 * the guardrails are the part that has to hold when a model behaves
 * unexpectedly, and they are the part a prompt alone cannot guarantee.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  lessonFindMany: vi.fn(),
  lessonUpdateMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  leadFindMany: vi.fn(),
  leadFindUnique: vi.fn(),
  leadUpdate: vi.fn(),
  eventCreate: vi.fn(),
  eventFindMany: vi.fn(),
  eventFindFirst: vi.fn(),
  readinessFindMany: vi.fn(),
  readinessFindUnique: vi.fn(),
  readinessUpdate: vi.fn(),
  requestDecision: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentLesson: { findMany: h.lessonFindMany, updateMany: h.lessonUpdateMany },
    agentRun: { create: h.runCreate, update: h.runUpdate, count: h.runCount },
    operatorLead: { findMany: h.leadFindMany, findUnique: h.leadFindUnique, update: h.leadUpdate },
    operatorOutreachEvent: { create: h.eventCreate, findMany: h.eventFindMany, findFirst: h.eventFindFirst },
    operatorPmsReadiness: { findMany: h.readinessFindMany, findUnique: h.readinessFindUnique, update: h.readinessUpdate },
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
import { verifierAgent } from "./verifier";
import { scoutAgent } from "./scout";
import { openerAgent } from "./opener";
import { replyDeskAgent } from "./reply-desk";
import { onboarderAgent } from "./onboarder";
import type { AgentDefinition, JobPayload } from "../runtime/types";

const now = new Date("2026-09-21T03:00:00Z");
const CLAIM = "https://bluepass.co/operator/claim/start/cairns-reef-dive";

const GOOD_OPENER = `Saw you run the reef trips out of Cairns on Rezdy. We have already built your BluePass page: ${CLAIM}

You set your own rates and we never mark you up. Listing is free, and we only earn when we bring you a booking. A fixed 5% of every booking goes back to the reef you dive.

Because you are on Rezdy we can connect to it, so your real trips and availability flow through and you change nothing.`;

function run(agent: AgentDefinition, payload: JobPayload, script: ScriptStep[]) {
  resetRegistryForTests();
  registerAgent(agent);
  const port = new ScriptedModel(script);
  const job = {
    id: "job_1",
    agentId: agent.id,
    kind: "manual",
    triggerKey: "manual:1",
    payload,
    status: "RUNNING",
    attempts: 1,
    maxAttempts: 3,
    runAfter: now,
    lockedAt: now,
    lastError: null,
    runId: null,
    createdAt: now,
    updatedAt: now,
  };
  return runJob(job as never, { now, port }).then((r) => ({ ...r, port }));
}

function toolResults(): { name: string; result: string }[] {
  return h.runUpdate.mock.calls.at(-1)![0].data.toolCalls ?? [];
}

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.lessonFindMany.mockResolvedValue([]);
  h.lessonUpdateMany.mockResolvedValue({ count: 0 });
  h.runCreate.mockResolvedValue({ id: "run_1" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.eventCreate.mockResolvedValue({});
  h.leadUpdate.mockResolvedValue({});
  h.requestDecision.mockResolvedValue({ decisionId: "dec_1", existing: false });
  h.dispatch.mockResolvedValue({ status: "sent", providerId: "msg_1" });
});

// ─── 01 Verifier ─────────────────────────────────────────────────────────────

describe("Verifier", () => {
  it("passes compliant copy and blocks every rule break in one pass", async () => {
    const r = await run(verifierAgent, { text: GOOD_OPENER, audience: "operator", kind: "first touch" }, [
      { tool: "verify_outbound", input: { text: GOOD_OPENER, audience: "operator", kind: "first touch" } },
      { tool: "record_verdict", input: { verdict: "pass", reasons: [] } },
    ]);
    expect(r.outcome.verdict).toBe("pass");
    expect(toolResults()[0].result).toBe("PASS. No copy-rule violations.");

    const bad = "Keep 100% of every booking, we price-match any OTA, 18% never touches you 🎉";
    const r2 = await run(verifierAgent, { text: bad, audience: "operator" }, [
      { tool: "verify_outbound", input: { text: bad, audience: "operator" } },
      { tool: "record_verdict", input: { verdict: "blocked", reasons: ["false promise"] } },
    ]);
    expect(r2.outcome.verdict).toBe("blocked");
    const out = toolResults()[0].result;
    for (const rule of ["no-keep-everything", "no-price-match", "only-conservation-percentage", "no-emoji"]) {
      expect(out).toContain(rule);
    }
  });

  it("opens a held decision for an unverified claim rather than guessing", async () => {
    await run(verifierAgent, { text: "Eco Certified since 2019.", audience: "customer", entityType: "OperatorLead", entityId: "lead_1" }, [
      { tool: "flag_for_person", input: { claim: "Eco Certified since 2019", why: "Nothing on file. Kirby would know." } },
      { tool: "record_verdict", input: { verdict: "blocked", reasons: ["unverified certification"] } },
    ]);
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: expect.objectContaining({ kind: "claim.unverified", defaultAction: "hold" }),
        req: expect.objectContaining({ entityId: "lead_1" }),
      }),
    );
  });
});

// ─── 02 Scout ────────────────────────────────────────────────────────────────

describe("Scout", () => {
  it("records the platform, the path and a priority on the lead's own log", async () => {
    h.leadFindMany.mockResolvedValue([
      { id: "lead_1", slug: "cairns-reef-dive", name: "Cairns Reef Dive", region: "QLD", category: "dive", websiteUrl: "cairnsreef.com.au", email: "hi@x.com", phone: "+617" },
    ]);
    h.leadFindUnique.mockResolvedValue({ id: "lead_1", slug: "cairns-reef-dive", name: "Cairns Reef Dive", email: "hi@x.com", phone: "+617", region: "QLD" });

    const r = await run(scoutAgent, {}, [
      { tool: "list_unassessed_leads", input: {} },
      { tool: "record_assessment", input: { lead_id: "lead_1", platform: "Rezdy", evidence: "rezdy.com" } },
    ]);

    const assessed = r.outcome.assessed as { platform: string; path: string; priority: number; pmsPlatform: string }[];
    expect(assessed[0]).toMatchObject({ platform: "Rezdy", path: "connect_now", priority: 100, pmsPlatform: "REZDY" });
    expect(h.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operatorLeadId: "lead_1", type: "agent.platform_assessed" }),
      }),
    );
    // Assessing is not contact: the lead must not be stamped as touched.
    expect(h.leadUpdate).not.toHaveBeenCalled();
  });

  it("pulls a lead that looks wrong out of outreach and asks a person", async () => {
    h.leadFindUnique.mockResolvedValue({ id: "lead_2", slug: "old-charters", name: "Old Charters", email: null, phone: null, region: "QLD" });
    await run(scoutAgent, {}, [
      { tool: "record_assessment", input: { lead_id: "lead_2", platform: "None detected", looks_wrong: "Domain is parked and the business appears to have closed." } },
    ]);
    expect(h.leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "lead_2" }, data: { status: "MANUAL_REVIEW" } }));
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ gate: expect.objectContaining({ kind: "lead.looks_wrong", assignee: "kirby" }) }),
    );
  });
});

// ─── 03 Opener ───────────────────────────────────────────────────────────────

describe("Opener", () => {
  const lead = { id: "lead_1", slug: "cairns-reef-dive", name: "Cairns Reef Dive", email: "hi@x.com", phone: "+617", claimUrl: CLAIM, status: "IMPORTED" };

  it("sends a verified opener and moves the lead to contacted", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    const r = await run(openerAgent, {}, [
      { tool: "verify_outbound", input: { text: GOOD_OPENER, audience: "operator", kind: "first touch" } },
      { tool: "send_first_touch", input: { lead_id: "lead_1", channel: "email", subject: "Your BluePass page", body: GOOD_OPENER } },
    ]);
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ channel: "email", to: "hi@x.com" }));
    expect(h.leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CONTACTED" } }));
    expect((r.outcome.touched as { status: string }[])[0].status).toBe("sent");
  });

  it("refuses to send anything the copy rules have not passed", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    await run(openerAgent, {}, [
      { tool: "send_first_touch", input: { lead_id: "lead_1", channel: "email", body: GOOD_OPENER } },
    ]);
    expect(toolResults()[0].result).toMatch(/Refused: the copy rules have not passed/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("refuses a message that does not carry that operator's own claim link", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    const noLink = "We built you a page, come and claim it. 5% of every booking goes to the ocean.";
    await run(openerAgent, {}, [
      { tool: "verify_outbound", input: { text: noLink, audience: "operator" } },
      { tool: "send_first_touch", input: { lead_id: "lead_1", channel: "email", body: noLink } },
    ]);
    expect(toolResults()[1].result).toMatch(/does not contain this lead's own claim link/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("will not contact a lead with no live claim page", async () => {
    h.leadFindUnique.mockResolvedValue({ ...lead, claimUrl: null });
    await run(openerAgent, {}, [
      { tool: "verify_outbound", input: { text: GOOD_OPENER, audience: "operator" } },
      { tool: "send_first_touch", input: { lead_id: "lead_1", channel: "email", body: GOOD_OPENER } },
    ]);
    expect(toolResults()[1].result).toMatch(/no live claim page/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("will not touch a lead someone has already contacted", async () => {
    h.leadFindUnique.mockResolvedValue({ ...lead, status: "IN_DISCUSSION" });
    await run(openerAgent, {}, [
      { tool: "verify_outbound", input: { text: GOOD_OPENER, audience: "operator" } },
      { tool: "send_first_touch", input: { lead_id: "lead_1", channel: "email", body: GOOD_OPENER } },
    ]);
    expect(toolResults()[1].result).toMatch(/already at IN_DISCUSSION/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("prepares an Instagram message for a person instead of sending it", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    const { dispatch: realDispatch } = await vi.importActual<typeof import("../tools/dispatch")>("../tools/dispatch");
    h.dispatch.mockImplementation(realDispatch);
    await run(openerAgent, {}, [
      { tool: "verify_outbound", input: { text: GOOD_OPENER, audience: "operator" } },
      { tool: "send_first_touch", input: { lead_id: "lead_1", channel: "instagram", body: GOOD_OPENER } },
    ]);
    const result = toolResults()[1].result;
    expect(result).toMatch(/Prepared/);
    expect(result).toMatch(/never sent by an agent|forbid automating/);
    expect(h.leadUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CONTACTED" } }));
  });
});

// ─── 04 Reply desk ───────────────────────────────────────────────────────────

describe("Reply desk", () => {
  const lead = { id: "lead_1", slug: "cairns-reef-dive", name: "Cairns Reef Dive", status: "CONTACTED", email: "hi@x.com", phone: "+617" };

  it("takes a no at face value: declined, suppressed, and nothing further sent", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    const r = await run(replyDeskAgent, { entityId: "lead_1", message: "Not interested, please take us off your list." }, [
      { tool: "classify_reply", input: { lead_id: "lead_1", classification: "no", reasoning: "Asked to be removed." } },
      { tool: "reply_to_operator", input: { lead_id: "lead_1", channel: "email", body: "Are you sure? Most operators find..." } },
    ]);
    expect(h.leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DECLINED" } }));
    expect(h.eventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "agent.suppressed" }) }));
    expect(toolResults()[1].result).toMatch(/Refused: this operator said no/);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(r.outcome.classification).toBe("no");
  });

  it("moves an interested operator into discussion and answers them", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    const answer = "Good question. You connect your Rezdy once and your real trips flow through, so nothing changes day to day. A fixed 5% of every booking goes to the reef.";
    await run(replyDeskAgent, { entityId: "lead_1", message: "How does the Rezdy bit actually work?" }, [
      { tool: "classify_reply", input: { lead_id: "lead_1", classification: "question", reasoning: "Asked how the Rezdy connection works." } },
      { tool: "verify_outbound", input: { text: answer, audience: "operator" } },
      { tool: "reply_to_operator", input: { lead_id: "lead_1", channel: "email", body: answer } },
    ]);
    expect(h.leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "IN_DISCUSSION" } }));
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ channel: "email" }));
  });

  it("sends an unclear reply to a person instead of guessing at it", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    await run(replyDeskAgent, { entityId: "lead_1", message: "?" }, [
      { tool: "classify_reply", input: { lead_id: "lead_1", classification: "unclear", reasoning: "One character; no meaning to read." } },
    ]);
    expect(h.leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "MANUAL_REVIEW" } }));
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ gate: expect.objectContaining({ kind: "reply.needs_person" }) }),
    );
  });

  it("never runs at all on an operator who already declined", async () => {
    h.leadFindUnique.mockResolvedValue({ ...lead, status: "DECLINED" });
    const r = await run(replyDeskAgent, { entityId: "lead_1", message: "hello again" }, []);
    expect(r.status).toBe("SKIPPED");
    expect(r.outcome.reason).toMatch(/already said no/);
    expect(r.port.calls).toHaveLength(0);
  });
});

// ─── 05 Onboarder ────────────────────────────────────────────────────────────

describe("Onboarder", () => {
  const lead = { id: "lead_1", slug: "cairns-reef-dive", name: "Cairns Reef Dive", email: "hi@x.com", phone: "+617", claimUrl: CLAIM, status: "IN_DISCUSSION" };
  const invite = `Here is the link to claim your page: ${CLAIM} . It takes a minute and you keep control of your own rates.`;

  it("sends the claim link and advances the lead, without claiming anything itself", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    await run(onboarderAgent, {}, [
      { tool: "verify_outbound", input: { text: invite, audience: "operator" } },
      { tool: "send_claim_invite", input: { lead_id: "lead_1", channel: "email", body: invite } },
    ]);
    expect(h.dispatch).toHaveBeenCalled();
    expect(h.leadUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CLAIM_LINK_REQUESTED" } }));
  });

  it("refuses a claim invite that does not carry the operator's own link", async () => {
    h.leadFindUnique.mockResolvedValue(lead);
    const noLink = "Just log in and claim your page when you get a minute.";
    await run(onboarderAgent, {}, [
      { tool: "verify_outbound", input: { text: noLink, audience: "operator" } },
      { tool: "send_claim_invite", input: { lead_id: "lead_1", channel: "email", body: noLink } },
    ]);
    expect(toolResults()[1].result).toMatch(/does not contain this operator's own claim link/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("will not chase an operator a person is already looking at", async () => {
    h.readinessFindUnique.mockResolvedValue({
      id: "rd_1", status: "MANUAL_REVIEW", platform: "REZDY", contactEmail: "hi@x.com", contactWhatsapp: null, notes: null,
      operatorProfile: { companyName: "Cairns Reef Dive" },
    });
    const msg = "Just one step left on your Rezdy connection.";
    await run(onboarderAgent, {}, [
      { tool: "verify_outbound", input: { text: msg, audience: "operator" } },
      { tool: "nudge_connection", input: { readiness_id: "rd_1", channel: "email", body: msg } },
    ]);
    expect(toolResults()[1].result).toMatch(/manual review/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("does not nudge an operator who is already connected and synced", async () => {
    h.readinessFindUnique.mockResolvedValue({
      id: "rd_2", status: "SYNCED", platform: "REZDY", contactEmail: "hi@x.com", contactWhatsapp: null, notes: null,
      operatorProfile: { companyName: "Cairns Reef Dive" },
    });
    const msg = "Checking in on your connection.";
    await run(onboarderAgent, {}, [
      { tool: "verify_outbound", input: { text: msg, audience: "operator" } },
      { tool: "nudge_connection", input: { readiness_id: "rd_2", channel: "email", body: msg } },
    ]);
    expect(toolResults()[1].result).toMatch(/already connected and synced/);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("records the nudge against the readiness so a second chase can see the first", async () => {
    h.readinessFindUnique.mockResolvedValue({
      id: "rd_3", status: "NEEDS_CREDENTIALS", platform: "REZDY", contactEmail: "hi@x.com", contactWhatsapp: null, notes: "existing note",
      operatorProfile: { companyName: "Cairns Reef Dive" },
    });
    h.readinessUpdate.mockResolvedValue({});
    const msg = "One approval inside your own Rezdy is all that is left. You never hand over a password.";
    await run(onboarderAgent, {}, [
      { tool: "verify_outbound", input: { text: msg, audience: "operator" } },
      { tool: "nudge_connection", input: { readiness_id: "rd_3", channel: "email", body: msg } },
    ]);
    const note = h.readinessUpdate.mock.calls[0][0].data.notes as string;
    expect(note).toContain("existing note");
    expect(note).toContain("onboarder nudge (NEEDS_CREDENTIALS, sent)");
  });

  it("escalates an operator a message will not fix", async () => {
    await run(onboarderAgent, {}, [
      { tool: "escalate_stuck_operator", input: { who: "Cairns Reef Dive", entity_type: "OperatorPmsReadiness", entity_id: "rd_9", what_is_stuck: "Credentials submitted twice; the connection keeps failing on BluePass's side." } },
    ]);
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ gate: expect.objectContaining({ kind: "onboarding.stuck", assignee: "kirby", defaultAction: "hold" }) }),
    );
  });
});
