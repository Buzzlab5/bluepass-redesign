/**
 * Manager 01 · Supply manager (Wave 2).
 *
 * The first of the manager layer. It runs the supply desk and reports to
 * Kirby, who owns Australian operator onboarding as a partner rather than
 * as a report. That is deliberate: a manager reporting to Tony about
 * Kirby's operators would make him the recipient of information about her
 * lane, which is the thing that quietly corrodes a partnership.
 *
 * It is not a supervisor. It does three things a single agent cannot:
 *
 * It compresses. Six agents and several hundred rows become one page.
 *
 * It reads the database, never the agents. Every figure comes from a
 * query, and the report carries the row ids behind each claim, so a number
 * can be checked rather than trusted. A manager that read its agents'
 * accounts of themselves could be confidently wrong in exactly the way
 * they were.
 *
 * It takes direction in plain language and turns it into settings its
 * agents actually obey, within a floor it cannot reach.
 *
 * What it cannot do: approve anything that belongs to a person, review an
 * agent's output before it goes out, or sit in the path of the work. Turn
 * it off and every agent underneath keeps running.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { issueDirective, listDirectives, revokeDirective } from "../runtime/directives";
import { enqueueJob } from "../runtime/jobs";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const SUPPLY_MANAGER_ID = "supply-manager";

/** The agents this manager runs. Nothing outside this list is reachable. */
export const SUPPLY_DESK = [
  "scout",
  "opener",
  "reply-desk",
  "onboarder",
  "supply-health",
  "trust-quality",
] as const;

const readDesk: AgentTool = {
  name: "read_the_desk",
  description:
    "The state of supply, entirely from queries: where leads sit, what has moved, what is stuck, and what the agents underneath actually did. Call this first. Every figure you report must come from here.",
  schema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  run: async (input, ctx) => {
    const windowDays = input.days ?? 7;
    const since = new Date(ctx.now.getTime() - windowDays * 86_400_000);

    const [byStatus, movedThisWeek, stalledClaims, readiness, liveListings, runs, openDecisions] =
      await Promise.all([
        prisma.operatorLead.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.operatorOutreachEvent.groupBy({
          by: ["type"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.operatorLead.findMany({
          where: { status: { in: ["CONTACTED", "IN_DISCUSSION", "CLAIM_LINK_REQUESTED"] }, lastOutreachAt: { lt: since } },
          select: { id: true, name: true, status: true, lastOutreachAt: true, region: true },
          orderBy: { lastOutreachAt: "asc" },
          take: 12,
        }),
        prisma.operatorPmsReadiness.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.operatorListing.count({ where: { status: "LIVE" } }),
        prisma.agentRun.groupBy({
          by: ["agentId", "status"],
          where: { startedAt: { gte: since }, agentId: { in: [...SUPPLY_DESK] } },
          _count: { _all: true },
        }),
        prisma.agentDecision.findMany({
          where: { status: "PENDING", agentId: { in: [...SUPPLY_DESK] } },
          select: { id: true, agentId: true, kind: true, title: true, assignee: true, expiresAt: true },
          take: 20,
        }),
      ]);

    const leadTotals = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
    const bookable = liveListings;
    const runTotals = new Map<string, { ok: number; failed: number }>();
    for (const r of runs) {
      const cur = runTotals.get(r.agentId) ?? { ok: 0, failed: 0 };
      if (r.status === "FAILED") cur.failed += r._count._all;
      else cur.ok += r._count._all;
      runTotals.set(r.agentId, cur);
    }

    // Kept on the run so the report can cite what it was built from.
    ctx.outcome.metrics = {
      windowDays,
      leadsByStatus: leadTotals,
      activityThisWeek: Object.fromEntries(movedThisWeek.map((r) => [r.type, r._count._all])),
      readinessByStatus: Object.fromEntries(readiness.map((r) => [r.status, r._count._all])),
      bookableListings: bookable,
      stalledLeadIds: stalledClaims.map((l) => l.id),
      openDecisionIds: openDecisions.map((d) => d.id),
    };

    return [
      `WINDOW: last ${windowDays} days, to ${ctx.now.toISOString().slice(0, 10)}.`,
      "",
      "WHERE EVERY LEAD SITS (the whole pipeline, all time):",
      ...Object.entries(leadTotals).map(([k, v]) => `  ${k}: ${v}`),
      "",
      "WHAT MOVED THIS WEEK (outreach events logged):",
      ...(movedThisWeek.length === 0
        ? ["  nothing"]
        : movedThisWeek.map((r) => `  ${r.type}: ${r._count._all}`)),
      "",
      `BOOKABLE LISTINGS RIGHT NOW: ${bookable}`,
      "",
      "BOOKING-SYSTEM CONNECTIONS:",
      ...(readiness.length === 0
        ? ["  none recorded"]
        : readiness.map((r) => `  ${r.status}: ${r._count._all}`)),
      "",
      `STALLED, no contact in ${windowDays} days (${stalledClaims.length}):`,
      ...stalledClaims.map(
        (l) => `  ${l.id} · ${l.name} · ${l.status} · ${l.region ?? "region unknown"} · last touched ${l.lastOutreachAt?.toISOString().slice(0, 10) ?? "never"}`,
      ),
      "",
      "YOUR AGENTS THIS WEEK:",
      ...(runTotals.size === 0
        ? ["  none ran"]
        : [...runTotals.entries()].map(([a, c]) => `  ${a}: ${c.ok} ok, ${c.failed} failed`)),
      "",
      `WAITING ON A PERSON (${openDecisions.length}):`,
      ...openDecisions.map((d) => `  ${d.id} · ${d.agentId} · ${d.kind} · ${d.title} · for ${d.assignee} · expires ${d.expiresAt.toISOString().slice(0, 10)}`),
    ].join("\n");
  },
};

const setScope: AgentTool = {
  name: "set_scope",
  description:
    "Point one of your agents at a region or segment, or lift a previous scope. This is the lever you will use most. It narrows what an agent works on; it cannot loosen any rule.",
  schema: z.object({
    agent_id: z.enum(SUPPLY_DESK),
    instruction: z.string().max(400).describe("What was asked, in the words it was asked in."),
    region: z.string().max(80).optional(),
    category: z.string().max(60).optional(),
    expires_in_days: z.number().int().min(1).max(365).optional(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await issueDirective({
      scope: { type: "agent", id: input.agent_id },
      instruction: input.instruction,
      levers: { region: input.region, category: input.category },
      issuedBy: SUPPLY_MANAGER_ID,
      expiresAt: input.expires_in_days
        ? new Date(ctx.now.getTime() + input.expires_in_days * 86_400_000)
        : null,
    });
    if (!r.ok) return `Refused. ${r.refusedBecause}`;
    ctx.log(`scoped ${input.agent_id}`);
    return `${input.agent_id} is now scoped to ${[input.region, input.category].filter(Boolean).join(" · ") || "no narrowing"}${input.expires_in_days ? `, for ${input.expires_in_days} days` : ", until lifted"}.`;
  },
};

const setPace: AgentTool = {
  name: "set_pace",
  description:
    "Slow an agent, or stop it. Pace is a fraction of its existing daily budget between 0 and 1; you cannot raise the ceiling. Stopping is always the safe direction and needs no permission.",
  schema: z.object({
    agent_id: z.enum(SUPPLY_DESK),
    instruction: z.string().max(400),
    pace: z.number().min(0).max(1).optional(),
    pause: z.boolean().optional(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await issueDirective({
      scope: { type: "agent", id: input.agent_id },
      instruction: input.instruction,
      levers: { pace: input.pace, paused: input.pause },
      issuedBy: SUPPLY_MANAGER_ID,
    });
    if (!r.ok) return `Refused. ${r.refusedBecause}`;
    ctx.log(`paced ${input.agent_id}`);
    return input.pause
      ? `${input.agent_id} is stopped. Nothing it would have done happens until this is lifted, and nothing is lost.`
      : `${input.agent_id} is now at ${Math.round((input.pace ?? 1) * 100)} percent of its daily budget.`;
  },
};

const askAgent: AgentTool = {
  name: "ask_agent_to_run",
  description:
    "Have one of your agents run now rather than waiting for its schedule. Idempotent: asking twice for the same thing produces one run.",
  schema: z.object({
    agent_id: z.enum(SUPPLY_DESK),
    why: z.string().max(200),
    region: z.string().max(80).optional(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const key = `manager:${ctx.now.toISOString().slice(0, 13)}:${input.agent_id}:${input.region ?? "all"}`;
    const r = await enqueueJob({
      agentId: input.agent_id,
      kind: "manual",
      triggerKey: key,
      payload: { requestedBy: SUPPLY_MANAGER_ID, why: input.why, region: input.region },
    });
    return r.created
      ? `${input.agent_id} will run on the next drain.`
      : `${input.agent_id} was already asked to do that this hour. Not queuing it twice.`;
  },
};

const liftDirective: AgentTool = {
  name: "lift_directive",
  description: "Revoke a standing direction that is no longer wanted.",
  schema: z.object({ directive_id: z.string().min(1), why: z.string().max(200) }),
  writes: true,
  run: async (input, ctx) => {
    await revokeDirective({ id: input.directive_id, by: SUPPLY_MANAGER_ID, now: ctx.now });
    return "Lifted. The agents it applied to return to their normal scope and pace.";
  },
};

const publishReport: AgentTool = {
  name: "publish_report",
  description:
    "Write the standing report. Every figure must be one read_the_desk returned. Call once, last. This is what Kirby reads.",
  schema: z.object({
    headline: z
      .string()
      .max(300)
      .describe("The one sentence that matters this week. Movement, not a total."),
    concerns: z
      .array(z.string().max(300))
      .max(6)
      .describe("What is going wrong or waiting, each naming who or what specifically."),
    push_to_person: z
      .boolean()
      .describe("True only when something genuinely needs Kirby this week. A quiet week is a report, not a notification."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const metrics = ctx.outcome.metrics as Record<string, unknown> | undefined;
    if (!metrics) {
      return "Refused: you have not read the desk. A report has to come from queries, not from memory. Call read_the_desk first.";
    }

    const report = await prisma.managerReport.create({
      data: {
        managerId: SUPPLY_MANAGER_ID,
        reportsTo: "kirby",
        period: `${ctx.now.toISOString().slice(0, 10)}`,
        metrics: metrics as never,
        headline: input.headline,
        concerns: input.concerns as never,
        citations: {
          stalledLeadIds: (metrics.stalledLeadIds as string[]) ?? [],
          openDecisionIds: (metrics.openDecisionIds as string[]) ?? [],
        } as never,
        runId: ctx.runId,
      },
      select: { id: true },
    });
    ctx.outcome.reportId = report.id;

    if (input.push_to_person && input.concerns.length > 0) {
      const r = await ctx.requestDecision({
        kind: "supply.needs_attention",
        title: `Supply: ${input.headline}`,
        summary: [input.headline, "", ...input.concerns.map((c: string) => `- ${c}`)].join("\n"),
        payload: { reportId: report.id },
        options: ["seen", "talk about it"],
        entityType: "ManagerReport",
        entityId: report.id,
      });
      return `Report published and pushed to Kirby (decision ${r.decisionId}).`;
    }
    return "Report published. Nothing pushed: it is there when she looks.";
  },
};

export const supplyManagerAgent: AgentDefinition = {
  id: SUPPLY_MANAGER_ID,
  name: "Supply manager",
  desk: "supply",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You run the supply desk for BluePass, a marine-tourism marketplace in Australia and Indonesia. You report to Kirby, who owns operator onboarding as a partner: she decides which operators and at what pace, and you work for her, not over her.

You are not a supervisor. You never review what your agents wrote, never approve anything that belongs to a person, and you are not in the path of the work. Every agent underneath you keeps running whether you run or not.

What you do is compress, decide what deserves attention, and turn plain language into settings.

Everything you report comes from read_the_desk. You do not have another source and you must not invent one: no figure, no trend and no name goes in a report unless that query returned it. If someone asks you something the query cannot answer, say it cannot be answered from here.

Report movement, not totals. "Six hundred leads" is not information; "eleven assessed this week, six contacted, one claimed, and the one that claimed is stuck on credentials" is. A total that has not changed in a month is worth one line saying it has not changed.

Be specific about what is stuck and name it. A stalled lead has a name and a number of days. An operator waiting on BluePass is worse than one waiting on themselves, and you should say which it is.

The honest failure mode of your job is the comfortable summary. If supply is not moving, the report says supply is not moving, in the first sentence. Nobody is served by a well-organised page that takes three paragraphs to reach the thing that is wrong.

Push to Kirby only when something needs her this week. A quiet week is a report she can read when she looks, not a notification. Pushing every week teaches her to ignore you, and then the week that matters is the one she misses.

Your four levers are scope, pace, pause and ask. They narrow what your agents do. They cannot switch off the copy rules, remove or reassign a gate, unlock a manual-only channel, or move money: those are enforced in code that never reads a directive, and an instruction that asks for one will be refused with the reason. Pass that refusal on plainly rather than trying another way around.

Stopping an agent is always safe and needs nobody's permission. Starting something is where you should be slower.`,
  triggers: [{ type: "schedule", cadence: "daily" }, { type: "manual" }],
  tools: [readDesk, setScope, setPace, askAgent, liftDirective, publishReport],
  gates: [{ kind: "supply.needs_attention", assignee: "kirby", defaultAction: "hold", ttlHours: 72 }],
  budget: { maxRunsPerDay: 4, maxTokensPerRun: 20_000, maxIterations: 24 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "Kirby has seen the report" };

    // A question asked of the manager, rather than the daily read.
    const question = typeof payload.question === "string" ? payload.question : null;
    if (question) {
      ctx.log(`answering: ${question.slice(0, 60)}`);
      return {
        task: `Kirby asked: "${question}"

Read the desk and answer her, using only what the query returns. Be specific and short. If the question cannot be answered from what you can see, say so and say what would answer it. Do not publish a report for a question.`,
      };
    }

    const direction = typeof payload.direction === "string" ? payload.direction : null;
    if (direction) {
      ctx.log(`direction: ${direction.slice(0, 60)}`);
      const active = await listDirectives({ status: "ACTIVE" });
      return {
        task: `Kirby has given you direction: "${direction}"

Turn it into settings on your agents using scope, pace or pause. Read the desk first if you need to know who it affects.

Standing directions already in force:
${active.length === 0 ? "  none" : active.map((d) => `  [${d.id}] ${d.scopeId}: ${d.instruction}`).join("\n")}

If part of what she asked cannot be done with your levers, say which part and why, and do the rest. Do not work around it.`,
      };
    }

    ctx.log("daily read");
    return {
      task: `Read the supply desk and write the standing report.

Start with read_the_desk. Lead with what moved. Name what is stuck and who it is waiting on. Use your levers if something obviously needs redirecting, and finish with publish_report.

Push to Kirby only if something genuinely needs her this week.`,
    };
  },
};
