/**
 * Agents 06 to 08. As with the first batch, most of what is asserted is
 * what each one refuses or escalates rather than what it does, because
 * that is the half a prompt cannot guarantee on its own.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  runCount: vi.fn(),
  listingFindMany: vi.fn(),
  listingFindUnique: vi.fn(),
  listingUpdate: vi.fn(),
  claimFindUnique: vi.fn(),
  claimFindMany: vi.fn(),
  cronFindMany: vi.fn(),
  agentRunFindMany: vi.fn(),
  agentRunGroupBy: vi.fn(),
  agentJobFindMany: vi.fn(),
  requestDecision: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    agentRun: {
      create: h.runCreate,
      update: h.runUpdate,
      count: h.runCount,
      findMany: h.agentRunFindMany,
      groupBy: h.agentRunGroupBy,
    },
    agentJob: { findMany: h.agentJobFindMany },
    operatorListing: { findMany: h.listingFindMany, findUnique: h.listingFindUnique, update: h.listingUpdate },
    operatorClaim: { findUnique: h.claimFindUnique, findMany: h.claimFindMany },
    cronRunLog: { findMany: h.cronFindMany },
  },
}));
vi.mock("../runtime/decisions", () => ({ requestDecision: h.requestDecision }));

import { runJob } from "../runtime/runner";
import { ScriptedModel, type ScriptStep } from "../runtime/model";
import { registerAgent, resetRegistryForTests } from "../runtime/registry";
import { supplyHealthAgent } from "./supply-health";
import { trustQualityAgent } from "./trust-quality";
import { watchAgent } from "./watch";
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
  h.runCreate.mockResolvedValue({ id: "run_1" });
  h.runUpdate.mockResolvedValue({});
  h.runCount.mockResolvedValue(0);
  h.requestDecision.mockResolvedValue({ decisionId: "dec_1", existing: false });
  h.listingUpdate.mockResolvedValue({});
  h.cronFindMany.mockResolvedValue([]);
  h.agentRunFindMany.mockResolvedValue([]);
  h.agentRunGroupBy.mockResolvedValue([]);
  h.agentJobFindMany.mockResolvedValue([]);
});

// ─── 06 Supply health ────────────────────────────────────────────────────────

describe("Supply health", () => {
  const good = {
    id: "l_ok", title: "Outer reef day trip", region: "QLD", category: "dive",
    description: "A full day on the outer reef with two dives, lunch and all gear included for certified divers.",
    heroImageUrl: "https://img/1.jpg", priceFrom: 189, priceSignal: "From AUD 189",
    externalProductId: "PROD1", publishedAt: now, updatedAt: now,
    operatorProfile: { companyName: "Cairns Reef Dive", status: "LIVE" },
  };

  it("passes a healthy catalogue without touching anything", async () => {
    h.listingFindMany.mockResolvedValue([good]);
    const r = await run(supplyHealthAgent, {}, [{ tool: "survey_live_listings", input: {} }]);
    expect(toolResults()[0].result).toMatch(/Nothing wrong with any of them/);
    expect(r.outcome.problemCount).toBe(0);
    expect(h.listingUpdate).not.toHaveBeenCalled();
  });

  it("spots a synced listing whose source has gone quiet, and demotes it", async () => {
    const stale = { ...good, id: "l_stale", updatedAt: new Date(now.getTime() - 72 * 3_600_000) };
    h.listingFindMany.mockResolvedValue([stale]);
    h.listingFindUnique.mockResolvedValue({ id: "l_stale", title: stale.title, status: "LIVE", operatorProfile: { companyName: "Cairns Reef Dive" } });

    const r = await run(supplyHealthAgent, {}, [
      { tool: "survey_live_listings", input: {} },
      { tool: "demote_listing", input: { listing_id: "l_stale", reason: "Synced from Rezdy but unchanged for 72 hours, so availability is not trustworthy." } },
    ]);

    expect(toolResults()[0].result).toMatch(/the sync has probably stopped/);
    expect(h.listingUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "l_stale" }, data: { status: "DRAFT" } }));
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ gate: expect.objectContaining({ kind: "listing.demoted", defaultAction: "hold" }) }),
    );
    expect((r.outcome.demoted as unknown[]).length).toBe(1);
  });

  it("does not call an operator-written listing stale, however old it is", async () => {
    h.listingFindMany.mockResolvedValue([
      { ...good, id: "l_hand", externalProductId: null, updatedAt: new Date(now.getTime() - 400 * 3_600_000) },
    ]);
    await run(supplyHealthAgent, {}, [{ tool: "survey_live_listings", input: {} }]);
    expect(toolResults()[0].result).toMatch(/Nothing wrong/);
  });

  it("will not demote a listing that is already out of Discover", async () => {
    h.listingFindUnique.mockResolvedValue({ id: "l_x", title: "Old trip", status: "ARCHIVED", operatorProfile: { companyName: "X" } });
    await run(supplyHealthAgent, {}, [
      { tool: "demote_listing", input: { listing_id: "l_x", reason: "stale" } },
    ]);
    expect(toolResults()[0].result).toMatch(/already ARCHIVED/);
    expect(h.listingUpdate).not.toHaveBeenCalled();
  });
});

// ─── 07 Trust and quality ────────────────────────────────────────────────────

describe("Trust and quality", () => {
  const base = {
    id: "claim_1", operatorSlug: "cairns-reef-dive", operatorName: "Cairns Reef Dive", yachtSlugs: [],
    status: "PENDING_REVIEW", claimantName: "Sam", claimantEmail: "sam@cairnsreefdive.com.au",
    claimantPhone: "+617", claimantRole: "Owner", websiteUrl: "https://cairnsreefdive.com.au",
    proofUrl: null, notes: null, createdAt: now,
    account: { id: "acc_1", email: "sam@cairnsreefdive.com.au", emailVerifiedAt: now, createdAt: new Date(now.getTime() - 86_400_000) },
  };

  it("recognises an email on the business's own domain as real evidence", async () => {
    h.claimFindUnique.mockResolvedValue(base);
    h.claimFindMany.mockResolvedValue([]);
    await run(trustQualityAgent, { entityId: "claim_1" }, [{ tool: "read_claim", input: { claim_id: "claim_1" } }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/Email domain matches the website: yes/);
    expect(out).toMatch(/No other claims on this business/);
  });

  it("marks a free email as unproven rather than suspicious", async () => {
    h.claimFindUnique.mockResolvedValue({ ...base, claimantEmail: "sam@gmail.com", account: { ...base.account, email: "sam@gmail.com" } });
    h.claimFindMany.mockResolvedValue([]);
    await run(trustQualityAgent, { entityId: "claim_1" }, [{ tool: "read_claim", input: { claim_id: "claim_1" } }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/proves nothing about who they work for/);
    expect(out).toMatch(/Email domain matches the website: NO/);
  });

  it("surfaces a competing claim on the same business", async () => {
    h.claimFindUnique.mockResolvedValue(base);
    h.claimFindMany.mockResolvedValue([
      { id: "claim_2", claimantEmail: "someone@else.com", status: "PENDING_REVIEW", createdAt: now },
    ]);
    await run(trustQualityAgent, { entityId: "claim_1" }, [{ tool: "read_claim", input: { claim_id: "claim_1" } }]);
    expect(toolResults()[0].result).toMatch(/OTHER CLAIMS ON THE SAME BUSINESS/);
  });

  it("hands every claim to a person and never approves one itself", async () => {
    h.claimFindUnique.mockResolvedValue(base);
    const r = await run(trustQualityAgent, { entityId: "claim_1" }, [
      { tool: "recommend_on_claim", input: { claim_id: "claim_1", recommendation: "looks_legitimate", confidence: "high", reasons: ["Email is on the business domain."] } },
    ]);
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: expect.objectContaining({ kind: "claim.review", defaultAction: "hold" }),
        req: expect.objectContaining({ options: ["approve", "decline", "ask for proof"] }),
      }),
    );
    expect(toolResults()[0].result).toMatch(/you cannot approve it/);
    expect(r.outcome.recommendation).toBe("looks_legitimate");
  });

  it("adds nothing to a claim a person has already decided", async () => {
    h.claimFindUnique.mockResolvedValue({ ...base, status: "APPROVED" });
    await run(trustQualityAgent, { entityId: "claim_1" }, [
      { tool: "recommend_on_claim", input: { claim_id: "claim_1", recommendation: "looks_legitimate", confidence: "high", reasons: ["fine"] } },
    ]);
    expect(toolResults()[0].result).toMatch(/already APPROVED/);
    expect(h.requestDecision).not.toHaveBeenCalled();
  });
});

// ─── 08 Watch ────────────────────────────────────────────────────────────────

describe("Watch", () => {
  it("treats a job that has gone silent as the serious signal, not the absent one", async () => {
    h.cronFindMany
      .mockResolvedValueOnce([]) // nothing ran in the window
      .mockResolvedValueOnce([{ jobName: "rezdy-agent-sync" }]); // but this job exists
    const r = await run(watchAgent, {}, [{ tool: "read_system_health", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/SILENT .*rezdy-agent-sync/s);
    expect(out).toMatch(/not in this window at all/);
    expect(r.outcome.silentJobs).toEqual([expect.stringContaining("rezdy-agent-sync")]);
  });

  it("reports failures and jobs that gave up", async () => {
    h.cronFindMany
      .mockResolvedValueOnce([{ jobName: "agents-drain", status: "FAILURE", errorMessage: "connection refused", finishedAt: now }])
      .mockResolvedValueOnce([{ jobName: "agents-drain" }]);
    h.agentRunFindMany.mockResolvedValue([{ agentId: "scout", error: "fetch timeout", triggerKey: "weekly:1", startedAt: now }]);
    h.agentJobFindMany.mockResolvedValue([{ agentId: "opener", kind: "schedule", triggerKey: "daily:1", attempts: 3, lastError: "no sender" }]);
    h.agentRunGroupBy.mockResolvedValue([{ agentId: "scout", status: "FAILED", _count: { _all: 4 } }]);

    const r = await run(watchAgent, {}, [{ tool: "read_system_health", input: {} }]);
    const out = toolResults()[0].result;
    expect(out).toMatch(/connection refused/);
    expect(out).toMatch(/JOBS THAT GAVE UP/);
    expect(out).toMatch(/scout: 0 ok, 4 failed/);
    expect(r.outcome.failedRuns).toBe(1);
    expect(r.outcome.stuckJobs).toBe(1);
  });

  it("raises one incident per cause and never restarts anything", async () => {
    h.cronFindMany.mockResolvedValue([]);
    await run(watchAgent, {}, [
      { tool: "raise_incident", input: { what_is_broken: "Rezdy sync has not run in three days", severity: "silent_failure", evidence: "last run 2026-09-18", likely_cause: "The cron was removed from the schedule.", what_it_affects: "Every synced operator's availability is going stale." } },
    ]);
    expect(h.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        gate: expect.objectContaining({ kind: "incident.raised", assignee: "inov" }),
        req: expect.objectContaining({ summary: expect.stringContaining("Nothing has been restarted") }),
      }),
    );
  });

  it("says so explicitly when everything is running", async () => {
    h.cronFindMany.mockResolvedValue([]);
    const r = await run(watchAgent, {}, [
      { tool: "read_system_health", input: {} },
      { tool: "report_all_well", input: { note: "All crons ran, no failed agent runs." } },
    ]);
    expect(r.outcome.allWell).toBe(true);
    expect(h.requestDecision).not.toHaveBeenCalled();
  });
});
