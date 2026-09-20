/**
 * Agent 11 · Coach (Wave 2).
 *
 * The agent that makes the others get better instead of plateauing.
 *
 * Once a week it reads what actually happened: which drafts the Verifier
 * blocked and on which rule, how operators replied to which kind of
 * opener, where a person overruled an agent's recommendation, what kept
 * failing. From that it proposes short, scoped lessons.
 *
 * It proposes. It never applies. A person makes a lesson active, and that
 * gate is the entire safety property of the learning loop: an agent able to
 * write its own instructions unreviewed will eventually write away the
 * instructions that constrain it, and every individual step of that will
 * read as reasonable.
 *
 * It also retires. A lesson that has been loaded a hundred times and never
 * corresponded to anything is noise in every future run, and noise that
 * accumulates is how a task prompt slowly becomes unreadable to the model
 * that has to act on it.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { listLessons, proposeLesson, retireLesson } from "../runtime/lessons";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const COACH_ID = "coach";

/** A lesson needs at least this many observations behind it. */
const MIN_EVIDENCE = 3;

const readOutcomes: AgentTool = {
  name: "read_recent_outcomes",
  description:
    "Read what actually happened across the agents in the window: blocked drafts and which rule blocked them, decisions and how a person answered them, failures, and how much each agent ran. Call this first.",
  schema: z.object({ days: z.number().int().min(1).max(60).optional() }),
  run: async (input, ctx) => {
    const since = new Date(ctx.now.getTime() - (input.days ?? 14) * 86_400_000);

    const [runs, decisions, lessons] = await Promise.all([
      prisma.agentRun.findMany({
        where: { startedAt: { gte: since }, status: { in: ["SUCCEEDED", "FAILED"] } },
        orderBy: { startedAt: "desc" },
        take: 300,
        select: { id: true, agentId: true, status: true, outcome: true, error: true, startedAt: true },
      }),
      prisma.agentDecision.findMany({
        where: { createdAt: { gte: since }, status: { in: ["APPROVED", "DENIED", "EXPIRED"] } },
        orderBy: { createdAt: "desc" },
        take: 120,
        select: { agentId: true, kind: true, title: true, status: true, decision: true, decidedBy: true },
      }),
      listLessons({ status: "ACTIVE", limit: 60 }),
    ]);

    // What the Verifier keeps blocking, per agent and per rule. This is the
    // sharpest signal available: it is deterministic, so a pattern here is
    // a real pattern rather than a model's impression of one.
    const blocks = new Map<string, Map<string, number>>();
    let verified = 0;
    for (const r of runs) {
      const o = (r.outcome ?? {}) as { verifications?: { pass: boolean; blocking?: string[] }[] };
      for (const v of o.verifications ?? []) {
        verified++;
        if (v.pass) continue;
        if (!blocks.has(r.agentId)) blocks.set(r.agentId, new Map());
        const m = blocks.get(r.agentId)!;
        for (const rule of v.blocking ?? []) m.set(rule, (m.get(rule) ?? 0) + 1);
      }
    }

    // How a person answered, per agent and per kind of question. Where they
    // consistently deny, the agent is asking for the wrong thing.
    const byKind = new Map<string, { approved: number; denied: number; expired: number }>();
    for (const d of decisions) {
      const key = `${d.agentId}:${d.kind}`;
      const cur = byKind.get(key) ?? { approved: 0, denied: 0, expired: 0 };
      if (d.status === "APPROVED") cur.approved++;
      else if (d.status === "DENIED") cur.denied++;
      else cur.expired++;
      byKind.set(key, cur);
    }

    const failures = new Map<string, string[]>();
    for (const r of runs) {
      if (r.status !== "FAILED" || !r.error) continue;
      const cur = failures.get(r.agentId) ?? [];
      if (cur.length < 3) cur.push(r.error.slice(0, 160));
      failures.set(r.agentId, cur);
    }

    const runsByAgent = new Map<string, number>();
    for (const r of runs) runsByAgent.set(r.agentId, (runsByAgent.get(r.agentId) ?? 0) + 1);

    ctx.outcome.windowDays = input.days ?? 14;
    ctx.outcome.runsRead = runs.length;

    return [
      `Window: ${runs.length} runs since ${since.toISOString().slice(0, 10)}. ${verified} drafts went through the copy rules.`,
      "",
      "BLOCKED BY THE COPY RULES (agent, rule, count):",
      ...(blocks.size === 0
        ? ["  nothing blocked in this window"]
        : [...blocks.entries()].flatMap(([agent, m]) =>
            [...m.entries()].map(([rule, n]) => `  ${agent} · ${rule} · ${n}`),
          )),
      "",
      "HOW A PERSON ANSWERED (agent, question, approved/denied/expired):",
      ...(byKind.size === 0
        ? ["  no decisions resolved in this window"]
        : [...byKind.entries()].map(([k, c]) => `  ${k} · ${c.approved}/${c.denied}/${c.expired}`)),
      "",
      "FAILURES:",
      ...(failures.size === 0
        ? ["  none"]
        : [...failures.entries()].map(([a, errs]) => `  ${a}: ${errs.join(" | ")}`)),
      "",
      "RUNS PER AGENT:",
      ...[...runsByAgent.entries()].map(([a, n]) => `  ${a}: ${n}`),
      "",
      `ACTIVE LESSONS ALREADY IN PLACE (${lessons.length}):`,
      ...lessons.map((l) => `  [${l.id}] ${l.agentId} · when ${l.scope}: ${l.lesson} · loaded ${l.timesApplied} times`),
    ].join("\n");
  },
};

const propose: AgentTool = {
  name: "propose_lesson",
  description:
    `Propose one lesson for one agent, from evidence you actually read. It does nothing until a person makes it active. Needs at least ${MIN_EVIDENCE} observations behind it; anything thinner is a hunch and will be refused.`,
  schema: z.object({
    agent_id: z.string().min(1),
    scope: z
      .string()
      .min(6)
      .max(140)
      .describe("When this applies, narrowly, e.g. 'writing a first touch to a Rezdy operator'."),
    lesson: z
      .string()
      .min(10)
      .max(400)
      .describe("What to do differently. One sentence, concrete, actionable."),
    observation_count: z.number().int().min(1).describe("How many times you saw this."),
    evidence: z.string().max(600).describe("What in the outcomes says this, quoted or counted."),
  }),
  writes: true,
  run: async (input, ctx) => {
    if (input.observation_count < MIN_EVIDENCE) {
      return `Refused: ${input.observation_count} observation(s) is not a pattern. A lesson needs at least ${MIN_EVIDENCE}. Leave it and see if it recurs.`;
    }
    // A lesson that tries to loosen a rule is the failure mode this whole
    // design guards against, so it is refused here as well as being unable
    // to take effect downstream.
    const loosening = /ignore|skip|bypass|without verif|do not run verify|no need to verify|override the rule|relax the/i;
    if (loosening.test(input.lesson)) {
      return "Refused: that lesson reads as loosening a rule. Rules are enforced in code and a lesson cannot reach them, so proposing one is either pointless or an attempt to work around a guardrail. Write the lesson as something to do, not something to skip.";
    }

    const r = await proposeLesson({
      agentId: input.agent_id,
      scope: input.scope,
      lesson: input.lesson,
      evidence: { observationCount: input.observation_count, note: input.evidence },
      proposedByRunId: ctx.runId,
    });
    if (r.duplicate) {
      return `There is already an open or active lesson for ${input.agent_id} in that scope. Not proposing a second; if the existing one is wrong, retire it instead.`;
    }

    const proposed = (ctx.outcome.proposed as unknown[] | undefined) ?? [];
    ctx.outcome.proposed = [...proposed, { id: r.lessonId, agentId: input.agent_id, scope: input.scope }];

    const decision = await ctx.requestDecision({
      kind: "lesson.proposed",
      title: `Teach ${input.agent_id}: ${input.scope}`,
      summary: [
        `When ${input.scope}:`,
        input.lesson,
        "",
        `Seen ${input.observation_count} times. ${input.evidence}`,
        "",
        "Approving adds this to that agent's context on every future run. Denying discards it. It cannot loosen any rule either way.",
      ].join("\n"),
      payload: { lessonId: r.lessonId, agentId: input.agent_id },
      options: ["teach it", "discard"],
      entityType: "AgentLesson",
      entityId: r.lessonId,
      onResolve: { agentId: COACH_ID, payload: { step: "apply-decision", lessonId: r.lessonId } },
    });
    ctx.log(`proposed lesson for ${input.agent_id}`);
    return `Proposed and sent for review (decision ${decision.decisionId}). It is inactive until a person approves it.`;
  },
};

const retire: AgentTool = {
  name: "retire_lesson",
  description:
    "Retire an active lesson that is no longer earning its place: it has been loaded many times without ever mattering, it has been overtaken by a change, or the evidence behind it turned out to be a one-off.",
  schema: z.object({
    lesson_id: z.string().min(1),
    reason: z.string().max(300),
  }),
  writes: true,
  run: async (input, ctx) => {
    await retireLesson({ id: input.lesson_id, reason: input.reason });
    const retired = (ctx.outcome.retired as unknown[] | undefined) ?? [];
    ctx.outcome.retired = [...retired, input.lesson_id];
    return `Retired. It will not be loaded again. Every lesson costs room in a task, so this is as useful as proposing one.`;
  },
};

const reportNothing: AgentTool = {
  name: "report_no_pattern",
  description:
    "Record that you read the window and found nothing worth teaching. Call this rather than proposing something weak.",
  schema: z.object({ note: z.string().max(400) }),
  run: async (input, ctx) => {
    ctx.outcome.noPattern = true;
    ctx.outcome.note = input.note;
    return "Recorded: nothing worth teaching this week.";
  },
};

export const coachAgent: AgentDefinition = {
  id: COACH_ID,
  name: "Coach",
  desk: "company",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You read how the BluePass agents actually performed and propose what they should do differently. You are the reason the system gets better rather than staying the same.

You never change anything. You propose, and a person decides. That is not a formality: an agent that could rewrite its own instructions would eventually rewrite the ones that constrain it, and every step of that would look sensible at the time.

The evidence worth trusting, in order:

The copy rules are deterministic, so a pattern in what they block is a real pattern. If the Opener has been blocked four times for stating a percentage, that is a lesson: name the specific habit and what to do instead.

How a person answered a decision is the next best signal. An agent whose questions are consistently denied is asking for the wrong thing, or asking too early. An agent whose questions always expire unanswered is asking about something nobody considers worth their time, and that is worth saying plainly rather than teaching the agent to ask more politely.

Repeated failures are usually a tool or a data problem, not a judgement problem. Do not write a lesson telling an agent to try harder at something that is broken. Say it belongs to the Watch instead.

What makes a good lesson:
- Narrow scope. "When writing a first touch to a Rezdy operator" beats "when writing".
- Concrete. Something an agent can actually do differently on the next run.
- Positive. Say what to do, not what to avoid. An instruction to skip something is either pointless, because rules are enforced in code, or it is an attempt to work around a guardrail.
- Backed by at least three observations. Two is a coincidence.

Retiring matters as much as proposing. Every active lesson takes room in every future run of that agent, and a task cluttered with stale advice is harder to act on than a clean one. If a lesson has been loaded many times and never corresponded to anything, retire it.

If the window shows nothing worth teaching, say so with report_no_pattern. A coach that produces a lesson every week regardless is a coach producing noise.`,
  triggers: [{ type: "schedule", cadence: "weekly" }, { type: "manual" }],
  tools: [readOutcomes, propose, retire, reportNothing],
  gates: [{ kind: "lesson.proposed", assignee: "tony", defaultAction: "deny", ttlHours: 168 }],
  budget: { maxRunsPerDay: 4, maxTokensPerRun: 18_000, maxIterations: 24 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) {
      const d = payload.decision;
      const lessonId = (d.payload as Record<string, unknown> | undefined)?.lessonId as string | undefined;
      const accepted = d.action === "teach it" || d.action === "approve";
      if (lessonId) {
        const { decideLesson } = await import("../runtime/lessons");
        await decideLesson({ id: lessonId, accept: accepted, by: "review", now: ctx.now });
      }
      return {
        skip: `lesson ${lessonId ?? "unknown"} ${accepted ? "is now active" : "was discarded"}`,
      };
    }
    ctx.log("reading the window");
    return {
      task: `Read how the agents did and decide what, if anything, is worth teaching.

Start with read_recent_outcomes. Propose at most three lessons, each backed by at least three observations. Retire any active lesson that has stopped earning its place. If there is no real pattern, say so.`,
    };
  },
};
