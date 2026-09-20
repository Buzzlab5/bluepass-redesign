/**
 * Agent 15 · Growth analyst (Wave 3).
 *
 * Reads the funnel end to end and says what it means. Interest arrives as
 * waitlist signups and signup leads, conversations happen in Kai, referral
 * links get clicked, and enquiries either become bookings or do not.
 *
 * The discipline this agent exists to hold is not finding patterns. It is
 * refusing to. At BluePass's current volume almost nothing is significant,
 * and a weekly readout that finds a story in eleven signups teaches
 * everyone to act on noise. The persona is written to make "too early to
 * say" the expected answer rather than an admission of failure.
 *
 * It proposes tests and never changes anything. Nothing it reads is
 * something it can act on: spend, copy and scope all belong elsewhere.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const GROWTH_ANALYST_ID = "growth-analyst";

/** Below this, a change between two periods is noise. */
const MIN_FOR_A_TREND = 30;

const readFunnel: AgentTool = {
  name: "read_the_funnel",
  description:
    "The whole funnel from queries: interest arriving, conversations started, referral clicks, enquiries, and what became a booking. Compares this period against the one before it. Every figure you report must come from here.",
  schema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  run: async (input, ctx) => {
    const days = input.days ?? 14;
    const thisFrom = new Date(ctx.now.getTime() - days * 86_400_000);
    const prevFrom = new Date(ctx.now.getTime() - days * 2 * 86_400_000);

    const window = (from: Date, to: Date) => ({ createdAt: { gte: from, lt: to } });

    const [
      waitlistNow, waitlistPrev,
      signupsNow, signupsPrev,
      kaiNow, kaiPrev,
      clicksNow, clicksPrev,
      inquiriesNow, inquiriesPrev,
      bookedNow,
      kaiByStatus,
      liveListings,
      publishedPosts,
    ] = await Promise.all([
      prisma.waitlistSignup.groupBy({ by: ["role"], where: window(thisFrom, ctx.now), _count: { _all: true } }),
      prisma.waitlistSignup.count({ where: window(prevFrom, thisFrom) }),
      prisma.signupLead.count({ where: window(thisFrom, ctx.now) }),
      prisma.signupLead.count({ where: window(prevFrom, thisFrom) }),
      prisma.kaiSession.groupBy({ by: ["channel"], where: window(thisFrom, ctx.now), _count: { _all: true } }),
      prisma.kaiSession.count({ where: window(prevFrom, thisFrom) }),
      prisma.referralClick.count({ where: window(thisFrom, ctx.now) }),
      prisma.referralClick.count({ where: window(prevFrom, thisFrom) }),
      prisma.bookingInquiry.count({ where: window(thisFrom, ctx.now) }),
      prisma.bookingInquiry.count({ where: window(prevFrom, thisFrom) }),
      prisma.bookingInquiry.count({ where: { ...window(thisFrom, ctx.now), bookingId: { not: null } } }),
      prisma.kaiSession.groupBy({ by: ["status"], where: window(thisFrom, ctx.now), _count: { _all: true } }),
      prisma.operatorListing.count({ where: { status: "LIVE" } }),
      prisma.blogPost.count({ where: { status: "PUBLISHED" } }),
    ]);

    const waitlistTotal = waitlistNow.reduce((n, r) => n + r._count._all, 0);
    const kaiTotal = kaiNow.reduce((n, r) => n + r._count._all, 0);

    const compare = (label: string, now: number, prev: number) => {
      const enough = now + prev >= MIN_FOR_A_TREND;
      const direction = now === prev ? "flat" : now > prev ? "up" : "down";
      return `  ${label}: ${now} this period, ${prev} last (${direction})${enough ? "" : " — TOO FEW TO MEAN ANYTHING"}`;
    };

    ctx.outcome.metrics = {
      days,
      waitlist: waitlistTotal,
      signupLeads: signupsNow,
      kaiSessions: kaiTotal,
      referralClicks: clicksNow,
      inquiries: inquiriesNow,
      inquiriesBooked: bookedNow,
      liveListings,
    };

    return [
      `PERIOD: last ${days} days, compared with the ${days} before it.`,
      `A change is only worth reading when the two periods together clear ${MIN_FOR_A_TREND}. Anything marked below is noise, and saying so is the right answer.`,
      "",
      "INTEREST ARRIVING:",
      compare("waitlist signups", waitlistTotal, waitlistPrev),
      ...waitlistNow.map((r) => `    of which ${r.role.toLowerCase()}: ${r._count._all}`),
      compare("operator and partner signups", signupsNow, signupsPrev),
      "",
      "CONVERSATIONS:",
      compare("Kai sessions", kaiTotal, kaiPrev),
      ...kaiNow.map((r) => `    ${r.channel}: ${r._count._all}`),
      ...kaiByStatus.map((r) => `    ${r.status}: ${r._count._all}`),
      "",
      "REFERRAL:",
      compare("link clicks", clicksNow, clicksPrev),
      "",
      "ENQUIRIES:",
      compare("enquiries", inquiriesNow, inquiriesPrev),
      `  became a booking: ${bookedNow}`,
      "",
      "WHAT THERE IS TO CONVERT INTO:",
      `  live listings: ${liveListings}`,
      `  published articles: ${publishedPosts}`,
      liveListings === 0
        ? "  NOTHING IS BOOKABLE. No funnel figure below the enquiry stage can improve until that changes, and no test you propose should assume otherwise."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
};

const writeReadout: AgentTool = {
  name: "write_readout",
  description:
    "Record the readout. Call once, last, and only after read_the_funnel. 'too_early_to_say' is a legitimate and often correct headline.",
  schema: z.object({
    headline: z.string().max(300).describe("One sentence. What actually changed, or that nothing did."),
    too_early_to_say: z
      .boolean()
      .describe("True when the numbers are too small to support any conclusion. Expected at this stage."),
    observations: z.array(z.string().max(300)).max(6),
    proposed_tests: z
      .array(
        z.object({
          test: z.string().max(200),
          why: z.string().max(200).describe("What in the numbers suggests it."),
          who_runs_it: z.string().max(60),
        }),
      )
      .max(3)
      .describe("Leave empty when nothing in the data justifies a test."),
  }),
  writes: true,
  run: async (input, ctx) => {
    if (!ctx.outcome.metrics) {
      return "Refused: you have not read the funnel. A readout has to come from queries, not from memory.";
    }
    ctx.outcome.headline = input.headline;
    ctx.outcome.tooEarly = input.too_early_to_say;
    ctx.outcome.observations = input.observations;
    ctx.outcome.proposedTests = input.proposed_tests;
    ctx.log(input.too_early_to_say ? "too early to say" : input.headline.slice(0, 60));

    if (input.too_early_to_say) {
      return "Recorded. Saying the numbers are too small is the honest answer and costs nothing; inventing a trend from them would cost real work chasing it.";
    }
    if (input.proposed_tests.length === 0) {
      return "Recorded, with no tests proposed. That is fine: a readout that always ends in a test is a readout nobody can trust.";
    }
    return `Recorded with ${input.proposed_tests.length} proposed test(s). Nothing has been changed; each one needs the person who owns it to pick it up.`;
  },
};

export const growthAnalystAgent: AgentDefinition = {
  id: GROWTH_ANALYST_ID,
  name: "Growth analyst",
  desk: "travellers",
  managedBy: "demand-manager",
  plane: "operating",
  wave: 3,
  modelTier: "reasoning",
  persona: `You read the BluePass funnel and say what it means. BluePass is a marine-tourism marketplace in Australia and Indonesia, and it is very early: there may be almost no traffic, almost no conversations and no bookings at all.

That last fact shapes this whole job. Your main discipline is not finding patterns. It is refusing to find them when they are not there.

At these volumes almost nothing is significant. Eleven signups this fortnight against eight last is not a fifty per cent rise, it is three people. The tool marks any comparison too small to read, and when it does, you say so plainly. "Too early to say" is the expected answer, not an admission of failure. A readout that finds a story in eleven signups teaches everyone to act on noise, and acting on noise is more expensive than doing nothing.

What is worth saying at low volume:
- Absolute counts and what they are not. "Four conversations, none of which reached an enquiry" is useful. "Conversation-to-enquiry rate down 60 per cent" is not, from four.
- A number that is zero when it should not be. Zero referral clicks when links have been issued is worth a sentence, because it points at something broken rather than something slow.
- The structural fact underneath. If nothing is bookable, nothing below the enquiry stage can improve, and no test worth running lives down there. Say that rather than analysing a funnel with no floor.

You never change anything. You propose tests, and every test names the person who would run it. Spend, copy, scope and pace all belong to other people. If a test needs money spent, say so explicitly so nobody mistakes it for something that can just happen.

Propose nothing when the data justifies nothing. A readout that always ends in a recommendation is a readout nobody can trust.

Everything you report comes from read_the_funnel. You have no other source, and you must not supply one from memory or from what is generally true of marketplaces.`,
  triggers: [{ type: "schedule", cadence: "weekly" }, { type: "manual" }],
  tools: [readFunnel, writeReadout],
  gates: [],
  budget: { maxRunsPerDay: 3, maxTokensPerRun: 16_000, maxIterations: 12 },
  buildTask: async (payload, ctx: RunContext) => {
    const days = typeof payload.days === "number" ? payload.days : 14;
    ctx.log(`reading the funnel, ${days} days`);
    return {
      task: `Read the funnel and write the readout for the last ${days} days.

Start with read_the_funnel. Lead with what actually changed, or say that nothing did. Where the tool marks a comparison as too small to read, do not read it. Propose a test only where the numbers genuinely point at one.`,
    };
  },
};
