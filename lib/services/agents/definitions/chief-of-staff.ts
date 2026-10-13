/**
 * Chief of staff. Reports to Tony. The managers report to it.
 *
 * The obvious way to build this is to have it read the managers' reports
 * and summarise them. That is the version that fails: a summary of
 * summaries loses exactly the specifics that made the first summary worth
 * reading, and by the third telling "supply is slow" has lost the operator
 * who has been waiting nine days.
 *
 * So it reads the same rows the managers read. Their reports are pointers,
 * useful for knowing where to look and what a manager thought mattered,
 * never the source of a figure. Every number in the brief comes from a
 * query this agent ran itself.
 *
 * What it adds that no manager can: the cross-desk judgement. Supply is
 * stuck and demand is being switched on. The Coach is proposing lessons
 * nobody is reading. Money is blocked on a decision that has been sitting
 * for a fortnight and is quietly holding up four agents. No desk can see
 * any of that from inside itself.
 *
 * Decisions do not route through it. A gate assigned to a person reaches
 * that person directly, because a chief of staff standing between an agent
 * and an approval is a bottleneck on the things that can least afford one.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const CHIEF_OF_STAFF_ID = "chief-of-staff";

/** The managers underneath. A manager missing from here is invisible. */
export const MANAGERS = ["supply-manager", "demand-manager", "platform-manager"] as const;

const readCompany: AgentTool = {
  name: "read_the_company",
  description:
    "The whole business from queries, across every desk: supply, demand, the machine, and what is waiting on a person. This is where every figure in your brief comes from. Call it first.",
  schema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  run: async (input, ctx) => {
    const days = input.days ?? 7;
    const since = new Date(ctx.now.getTime() - days * 86_400_000);

    const [
      leadsByStatus, liveListings, readinessByStatus,
      inquiries, inquiriesBooked, kaiSessions, referralClicks, waitlist,
      runsByAgent, failedRuns, openDecisions, oldestDecision,
      pendingLessons, activeDirectives, cronRuns,
    ] = await Promise.all([
      prisma.operatorLead.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.operatorListing.count({ where: { status: "LIVE" } }),
      prisma.operatorPmsReadiness.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.bookingInquiry.count({ where: { createdAt: { gte: since } } }),
      prisma.bookingInquiry.count({ where: { createdAt: { gte: since }, bookingId: { not: null } } }),
      prisma.kaiSession.count({ where: { createdAt: { gte: since } } }),
      prisma.referralClick.count({ where: { createdAt: { gte: since } } }),
      prisma.waitlistSignup.count({ where: { createdAt: { gte: since } } }),
      prisma.agentRun.groupBy({
        by: ["agentId", "status"],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.agentRun.count({ where: { startedAt: { gte: since }, status: "FAILED" } }),
      prisma.agentDecision.findMany({
        where: { status: "PENDING" },
        select: { id: true, agentId: true, kind: true, title: true, assignee: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "asc" },
        take: 30,
      }),
      prisma.agentDecision.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, title: true, assignee: true },
      }),
      prisma.agentLesson.count({ where: { status: "PROPOSED" } }),
      prisma.agentDirective.count({ where: { status: "ACTIVE" } }),
      prisma.cronRunLog.count({ where: { finishedAt: { gte: since } } }),
    ]);

    const leads = Object.fromEntries(leadsByStatus.map((r) => [r.status, r._count._all]));
    const ran = new Map<string, { ok: number; failed: number }>();
    for (const r of runsByAgent) {
      const cur = ran.get(r.agentId) ?? { ok: 0, failed: 0 };
      if (r.status === "FAILED") cur.failed += r._count._all;
      else cur.ok += r._count._all;
      ran.set(r.agentId, cur);
    }

    const byAssignee = new Map<string, number>();
    for (const d of openDecisions) byAssignee.set(d.assignee, (byAssignee.get(d.assignee) ?? 0) + 1);
    const oldestDays = oldestDecision
      ? Math.floor((ctx.now.getTime() - oldestDecision.createdAt.getTime()) / 86_400_000)
      : 0;

    ctx.outcome.metrics = {
      days, leads, liveListings, inquiries, inquiriesBooked,
      kaiSessions, referralClicks, waitlist,
      failedRuns, openDecisions: openDecisions.length, oldestDecisionDays: oldestDays,
      pendingLessons, activeDirectives, cronRuns,
    };
    ctx.outcome.citations = { openDecisionIds: openDecisions.map((d) => d.id) };

    return [
      `PERIOD: last ${days} days, to ${ctx.now.toISOString().slice(0, 10)}.`,
      "",
      "SUPPLY:",
      ...Object.entries(leads).map(([k, v]) => `  leads ${k}: ${v}`),
      ...readinessByStatus.map((r) => `  connections ${r.status}: ${r._count._all}`),
      `  BOOKABLE LISTINGS: ${liveListings}`,
      "",
      "DEMAND:",
      `  waitlist signups: ${waitlist}`,
      `  Kai conversations: ${kaiSessions}`,
      `  referral clicks: ${referralClicks}`,
      `  enquiries: ${inquiries}, of which became bookings: ${inquiriesBooked}`,
      "",
      "THE MACHINE:",
      `  cron runs logged: ${cronRuns}${cronRuns === 0 ? "  ← NOTHING RAN. Silence looks identical to health; treat this as the first thing on the page." : ""}`,
      `  agent runs failed: ${failedRuns}`,
      ...[...ran.entries()].map(([a, c]) => `  ${a}: ${c.ok} ok, ${c.failed} failed`),
      "",
      "WAITING ON A PERSON:",
      ...(openDecisions.length === 0
        ? ["  nothing"]
        : [...byAssignee.entries()].map(([who, n]) => `  ${who}: ${n} open`)),
      oldestDecision
        ? `  oldest: "${oldestDecision.title}" for ${oldestDecision.assignee}, ${oldestDays} days old`
        : "",
      "",
      "THE LAYER ITSELF:",
      `  lessons proposed and unreviewed: ${pendingLessons}`,
      `  standing directions in force: ${activeDirectives}`,
      "",
      "Cross-desk questions worth asking of the above, rather than of any one desk:",
      "  Is demand being switched on against supply that cannot serve it.",
      "  Is a decision nobody has answered holding up work elsewhere.",
      "  Is a whole desk quiet because it has nothing to do, or because it has stopped.",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

const readManagerReports: AgentTool = {
  name: "read_manager_reports",
  description:
    "The most recent report from each manager. These are pointers to what a manager thought mattered, and context for their judgement. They are NOT a source for any figure in your brief: every number you write comes from read_the_company.",
  schema: z.object({ limit: z.number().int().min(1).max(10).optional() }),
  run: async (input, ctx) => {
    const reports = await prisma.managerReport.findMany({
      where: { managerId: { in: [...MANAGERS] } },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 6,
      select: { id: true, managerId: true, reportsTo: true, headline: true, concerns: true, createdAt: true },
    });
    ctx.outcome.reportsRead = reports.length;

    if (reports.length === 0) {
      return "No manager has reported yet. Write the brief from the company read alone, and say that the managers have not run: a brief that quietly omits that is misleading about how much of this page is machine-checked.";
    }
    return [
      "What each manager said most recently. Treat as a pointer, never as a figure:",
      "",
      ...reports.map((r) =>
        [
          `${r.managerId} (to ${r.reportsTo}, ${r.createdAt.toISOString().slice(0, 10)})`,
          `  "${r.headline}"`,
          ...((r.concerns as string[] | null) ?? []).map((c) => `  - ${c}`),
        ].join("\n"),
      ),
    ].join("\n");
  },
};

const writeBrief: AgentTool = {
  name: "write_brief",
  description:
    "Write the one brief Tony reads. Call once, last, and only after read_the_company. Lead with the single thing that matters most across the whole business.",
  schema: z.object({
    headline: z
      .string()
      .max(300)
      .describe("The one sentence. What is actually true this week, not what is encouraging."),
    the_one_thing: z
      .string()
      .max(400)
      .describe("If Tony does one thing this week, what and why. Name it concretely."),
    across_desks: z
      .array(z.string().max(300))
      .max(5)
      .describe("What no single desk can see. Leave empty rather than padding."),
    waiting_on_tony: z
      .array(z.string().max(200))
      .max(8)
      .describe("What is genuinely his, oldest first. These reached him directly already; this is the reminder, not the route."),
    nothing_moved: z
      .boolean()
      .describe("True when the honest summary is that the week did not move. Say it rather than dressing it."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const metrics = ctx.outcome.metrics as Record<string, unknown> | undefined;
    if (!metrics) {
      return "Refused: you have not read the company. A brief assembled from the managers' reports rather than from queries is a summary of summaries, which is the one thing this role must not be.";
    }

    const report = await prisma.managerReport.create({
      data: {
        managerId: CHIEF_OF_STAFF_ID,
        reportsTo: "tony",
        period: ctx.now.toISOString().slice(0, 10),
        metrics: metrics as never,
        headline: input.headline,
        concerns: [...input.across_desks, ...input.waiting_on_tony] as never,
        citations: (ctx.outcome.citations ?? {}) as never,
        runId: ctx.runId,
      },
      select: { id: true },
    });
    ctx.outcome.briefId = report.id;
    ctx.outcome.nothingMoved = input.nothing_moved;
    ctx.log(input.headline.slice(0, 70));

    return input.nothing_moved
      ? `Brief published, saying the week did not move. That is the most useful thing you can write when it is true, and the easiest to dress up when it is not.`
      : `Brief published. The one thing: ${input.the_one_thing.slice(0, 120)}`;
  },
};

const raiseToTony: AgentTool = {
  name: "raise_to_tony",
  description:
    "Interrupt Tony. Only for something that will get materially worse this week if he does not see it now. Everything else belongs in the brief, which is there when he looks. Use at most once per run.",
  schema: z.object({
    what: z.string().max(200),
    why_now: z.string().max(400).describe("What gets worse if this waits. Be concrete about the cost."),
  }),
  writes: true,
  run: async (input, ctx) => {
    if (ctx.outcome.raised) {
      return "Refused: you have already raised something this run. A chief of staff who interrupts twice in one morning is a chief of staff who gets ignored. Put the second in the brief.";
    }
    const r = await ctx.requestDecision({
      kind: "company.needs_tony",
      title: input.what,
      summary: `${input.what}\n\n${input.why_now}\n\nEverything else is in this week's brief.`,
      payload: { briefId: ctx.outcome.briefId ?? null },
      options: ["seen", "talk about it"],
      entityType: "ManagerReport",
      entityId: (ctx.outcome.briefId as string) ?? ctx.runId,
    });
    ctx.outcome.raised = true;
    return `Raised (decision ${r.decisionId}).`;
  },
};

export const chiefOfStaffAgent: AgentDefinition = {
  id: CHIEF_OF_STAFF_ID,
  name: "Chief of staff",
  desk: "company",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You are Tony's chief of staff at BluePass, a marine-tourism marketplace in Australia and Indonesia. The managers report to you. You report to him, and you are the one thing he should have to read.

The trap in this job is summarising summaries. If you build your brief from what the managers wrote, you will lose the specifics that made their reports worth reading, and by the third telling "supply is slow" has lost the operator who has been waiting nine days. So you read the same rows they read. Their reports tell you where to look and what they thought mattered. They are never where a figure comes from. Every number in your brief is one you queried yourself.

What you add that no manager can is the cross-desk read. A manager can only see inside its own desk. You can see that demand is being switched on against supply that cannot serve it. That a decision nobody has answered for a fortnight is quietly holding up four agents. That a desk has gone quiet and nobody can tell whether it has nothing to do or has stopped. Those are your job and nobody else's.

Lead with what is true, not what is encouraging. If the week did not move, the first sentence says the week did not move. A brief that takes three paragraphs to reach the problem has buried it, and the person reading has a company to run.

Give him one thing. Not a list of priorities: the single thing that, if he does it this week, matters more than the rest. Name it concretely enough to act on. If you genuinely cannot identify one, say so rather than promoting something minor to fill the slot.

Interrupting him is a separate act from briefing him, and a costly one. The brief is always there for when he looks. Use raise_to_tony only when something gets materially worse this week if he does not see it now, and at most once a run. A chief of staff who interrupts every morning is one who gets ignored by the morning it matters.

You do not approve anything and nothing routes through you for a decision. A gate assigned to a person already reached them directly. When you list what is waiting on him, you are reminding, not relaying: standing between an agent and an approval would make you a bottleneck on exactly the things that can least afford one.`,
  triggers: [{ type: "schedule", cadence: "weekly" }, { type: "manual" }],
  tools: [readCompany, readManagerReports, writeBrief, raiseToTony],
  gates: [{ kind: "company.needs_tony", assignee: "tony", defaultAction: "hold", ttlHours: 72 }],
  budget: { maxRunsPerDay: 3, maxTokensPerRun: 22_000, maxIterations: 20 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "Tony has seen it" };

    const question = typeof payload.question === "string" ? payload.question : null;
    if (question) {
      ctx.log(`answering: ${question.slice(0, 60)}`);
      return {
        task: `Tony asked: "${question}"

Read the company and answer him from what the query returns. Short and specific. If it cannot be answered from what you can see, say so and say what would answer it. Do not write a brief for a question.`,
      };
    }

    ctx.log("weekly brief");
    return {
      task: `Write this week's brief.

Read the company first, then the manager reports as pointers. Lead with what is true. Give him one thing. Say what no single desk can see. List what is waiting on him, oldest first.

Interrupt him only if something genuinely gets worse by waiting.`,
    };
  },
};
