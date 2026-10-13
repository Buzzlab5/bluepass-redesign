/**
 * Manager 03 · Demand manager (Wave 2).
 *
 * Runs everything that brings travellers in and converts them: the partner
 * desk, the referral mesh, the content studio, the growth analyst, and in
 * time the concierge itself.
 *
 * It carries one judgement the others do not, and it is a restraining one.
 * Demand is the half of a marketplace you can buy, and buying it before
 * supply can serve it is the classic way a two-sided business burns its
 * first audience. A partner who sends a client into an empty catalogue does
 * not send a second. A traveller who finds nothing bookable does not come
 * back and check.
 *
 * So this manager's first duty is to know whether there is anything to sell,
 * and to hold its own desk back when there is not. It is the only manager
 * whose correct answer is often "we should be doing less of this".
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { issueDirective } from "../runtime/directives";
import { enqueueJob } from "../runtime/jobs";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const DEMAND_MANAGER_ID = "demand-manager";

export const DEMAND_DESK = [
  "partner-desk",
  "referral-mesh",
  "content-studio",
  "growth-analyst",
] as const;

/** Below this many bookable listings, demand work outruns what it can serve. */
const SUPPLY_FLOOR = 15;

const readDemand: AgentTool = {
  name: "read_the_desk",
  description:
    "Demand, and the supply it has to sell. Reports how much is actually bookable first, because that governs everything else. Every figure you report comes from here.",
  schema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  run: async (input, ctx) => {
    const days = input.days ?? 7;
    const since = new Date(ctx.now.getTime() - days * 86_400_000);
    const w = { createdAt: { gte: since } };

    const [liveListings, regions, partners, links, clicks, inquiries, booked, sessions, posts, runs] =
      await Promise.all([
        prisma.operatorListing.count({ where: { status: "LIVE" } }),
        prisma.operatorListing.findMany({
          where: { status: "LIVE" },
          select: { region: true },
          distinct: ["region"],
          take: 30,
        }),
        prisma.partnerProfile.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.referralLink.count({ where: { active: true } }),
        prisma.referralClick.count({ where: w }),
        prisma.bookingInquiry.count({ where: w }),
        prisma.bookingInquiry.count({ where: { ...w, bookingId: { not: null } } }),
        prisma.kaiSession.count({ where: w }),
        prisma.blogPost.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.agentRun.groupBy({
          by: ["agentId", "status"],
          where: { startedAt: { gte: since }, agentId: { in: [...DEMAND_DESK] } },
          _count: { _all: true },
        }),
      ]);

    const ran = new Map<string, { ok: number; failed: number }>();
    for (const r of runs) {
      const cur = ran.get(r.agentId) ?? { ok: 0, failed: 0 };
      if (r.status === "FAILED") cur.failed += r._count._all;
      else cur.ok += r._count._all;
      ran.set(r.agentId, cur);
    }

    ctx.outcome.metrics = {
      days, liveListings,
      regionsWithSupply: regions.map((r) => r.region).filter(Boolean),
      activeLinks: links, clicks, inquiries, booked, sessions,
      belowSupplyFloor: liveListings < SUPPLY_FLOOR,
    };

    return [
      `WHAT THERE IS TO SELL: ${liveListings} bookable listings across ${regions.length} region(s).`,
      liveListings < SUPPLY_FLOOR
        ? `  BELOW THE FLOOR. Under ${SUPPLY_FLOOR} bookable listings, demand work outruns what BluePass can serve. Every partner sent to this catalogue is one you may not get a second chance with, and every traveller who finds nothing does not come back to check. Holding your desk back is the correct call, not a failure of ambition.`
        : "  Enough to sell against.",
      "",
      "PARTNERS:",
      ...(partners.length === 0 ? ["  none"] : partners.map((p) => `  ${p.status}: ${p._count._all}`)),
      `  active links: ${links}`,
      `  clicks this period: ${clicks}`,
      "",
      "TRAVELLERS:",
      `  Kai conversations: ${sessions}`,
      `  enquiries: ${inquiries}, became bookings: ${booked}`,
      "",
      "CONTENT:",
      ...(posts.length === 0 ? ["  nothing written"] : posts.map((p) => `  ${p.status}: ${p._count._all}`)),
      "",
      "YOUR AGENTS:",
      ...(ran.size === 0 ? ["  none ran"] : [...ran.entries()].map(([a, c]) => `  ${a}: ${c.ok} ok, ${c.failed} failed`)),
    ].join("\n");
  },
};

const holdBack: AgentTool = {
  name: "hold_desk_back",
  description:
    "Slow or stop a demand agent because there is not enough supply to justify what it would do. This is the lever this desk exists to use well. Stopping is always safe and needs no permission.",
  schema: z.object({
    agent_id: z.enum(DEMAND_DESK),
    instruction: z.string().max(300).describe("Why, naming the supply position."),
    pace: z.number().min(0).max(1).optional(),
    pause: z.boolean().optional(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await issueDirective({
      scope: { type: "agent", id: input.agent_id },
      instruction: input.instruction,
      levers: { pace: input.pace, paused: input.pause },
      issuedBy: DEMAND_MANAGER_ID,
    });
    if (!r.ok) return `Refused. ${r.refusedBecause}`;
    ctx.log(`${input.pause ? "held" : "slowed"} ${input.agent_id}`);
    return input.pause
      ? `${input.agent_id} is held. Nothing is lost by waiting; a partner burned on an empty catalogue is.`
      : `${input.agent_id} is now at ${Math.round((input.pace ?? 1) * 100)} percent of its daily budget.`;
  },
};

const setScope: AgentTool = {
  name: "set_scope",
  description:
    "Point a demand agent at the regions where BluePass actually has supply, so it stops selling what does not exist.",
  schema: z.object({
    agent_id: z.enum(DEMAND_DESK),
    instruction: z.string().max(300),
    region: z.string().max(80).optional(),
    category: z.string().max(60).optional(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await issueDirective({
      scope: { type: "agent", id: input.agent_id },
      instruction: input.instruction,
      levers: { region: input.region, category: input.category },
      issuedBy: DEMAND_MANAGER_ID,
    });
    if (!r.ok) return `Refused. ${r.refusedBecause}`;
    return `${input.agent_id} scoped to ${[input.region, input.category].filter(Boolean).join(" · ") || "no narrowing"}.`;
  },
};

const askAgent: AgentTool = {
  name: "ask_agent_to_run",
  description: "Have a demand agent run now rather than waiting for its schedule. Idempotent within the hour.",
  schema: z.object({ agent_id: z.enum(DEMAND_DESK), why: z.string().max(200) }),
  writes: true,
  run: async (input, ctx) => {
    const r = await enqueueJob({
      agentId: input.agent_id,
      kind: "manual",
      triggerKey: `manager:${ctx.now.toISOString().slice(0, 13)}:${input.agent_id}`,
      payload: { requestedBy: DEMAND_MANAGER_ID, why: input.why },
    });
    return r.created ? `${input.agent_id} will run on the next drain.` : "Already asked this hour.";
  },
};

const publishReport: AgentTool = {
  name: "publish_report",
  description: "Write the standing report. Call once, last, and only after read_the_desk.",
  schema: z.object({
    headline: z.string().max(300),
    holding_back: z.boolean().describe("True when the right call this week is to do less."),
    concerns: z.array(z.string().max(300)).max(6),
    push_to_person: z.boolean(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const metrics = ctx.outcome.metrics as Record<string, unknown> | undefined;
    if (!metrics) {
      return "Refused: you have not read the desk. A report has to come from queries, not from memory.";
    }
    const report = await prisma.managerReport.create({
      data: {
        managerId: DEMAND_MANAGER_ID,
        reportsTo: "chief-of-staff",
        period: ctx.now.toISOString().slice(0, 10),
        metrics: metrics as never,
        headline: input.headline,
        concerns: input.concerns as never,
        citations: { regionsWithSupply: (metrics.regionsWithSupply as string[]) ?? [] } as never,
        runId: ctx.runId,
      },
      select: { id: true },
    });
    ctx.outcome.reportId = report.id;

    if (input.push_to_person && input.concerns.length > 0) {
      const r = await ctx.requestDecision({
        kind: "demand.needs_attention",
        title: `Demand: ${input.headline}`,
        summary: [input.headline, "", ...input.concerns.map((c: string) => `- ${c}`)].join("\n"),
        payload: { reportId: report.id },
        options: ["seen", "talk about it"],
        entityType: "ManagerReport",
        entityId: report.id,
      });
      return `Report published and raised (decision ${r.decisionId}).`;
    }
    return input.holding_back
      ? "Report published, recommending the desk does less this week. That is the harder recommendation to write and usually the right one at this stage."
      : "Report published.";
  },
};

export const demandManagerAgent: AgentDefinition = {
  id: DEMAND_MANAGER_ID,
  name: "Demand manager",
  desk: "multipliers",
  managedBy: "chief-of-staff",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You run the demand desk for BluePass, a marine-tourism marketplace in Australia and Indonesia: partners, referrals, content and the funnel.

Your first duty is restraint, and you should expect to exercise it for some time.

Demand is the half of a marketplace you can buy. Supply is not. Buying demand before supply can serve it is the standard way a two-sided business burns the audience it will need later: a partner who sends a client into an empty catalogue does not send a second one, and a traveller who finds nothing bookable does not come back to check whether that changed. Both of those are permanent in a market small enough that people talk.

So you read what is actually bookable before anything else, and if it is below the floor you hold your own desk back and say so. "We should be doing less of this" is the correct recommendation at this stage, not a failure of ambition, and writing it plainly is harder and more useful than filling the page with activity.

What is worth doing below the floor: content, because search rankings compound over months and the work done now is what ranks when supply arrives. Reviewing partner applications, so there is a bench ready. What is not: issuing links people cannot use, or pointing the funnel at regions with nothing in them.

Everything you report comes from read_the_desk. Report movement, not totals, and be specific about which regions have supply and which do not, because "we have listings" and "we have listings where this partner sells" are different facts.

Your levers only narrow. You can hold an agent back, slow it, or point it at a region that actually has inventory. Stopping is always safe. You cannot loosen a rule, remove a gate, or make anything go faster than its own definition allows.

You report to the chief of staff, who reads the same rows you do. Do not write for an audience that cannot check you: write the honest version.`,
  triggers: [{ type: "schedule", cadence: "weekly" }, { type: "manual" }],
  tools: [readDemand, holdBack, setScope, askAgent, publishReport],
  gates: [{ kind: "demand.needs_attention", assignee: "tony", defaultAction: "hold", ttlHours: 72 }],
  budget: { maxRunsPerDay: 3, maxTokensPerRun: 18_000, maxIterations: 20 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "the demand concern was seen" };
    ctx.log("reading the demand desk");
    return {
      task: `Read the demand desk and write the standing report.

Start with read_the_desk. Check what is actually bookable before anything else. If supply is below the floor, hold your agents back and say so plainly rather than filling the week with activity that costs BluePass its first audience.`,
    };
  },
};
