/**
 * Agent 06 · Supply health (Wave 1).
 *
 * Watches what travellers can actually see and book, and catches the two
 * failures nobody notices until a guest does.
 *
 * A listing goes stale: the operator's system stopped syncing, or the
 * listing was published without the things a traveller needs to decide. It
 * stays on the site looking bookable.
 *
 * A listing is wrong in a way that costs trust rather than a sale: no
 * price, no description, no image, a region that does not match the trip.
 *
 * The consequential power here is demotion: pulling a listing out of
 * Discover before a traveller books something the operator cannot honour.
 * A booking BluePass cannot deliver is worse than a listing nobody sees,
 * so the agent may demote on its own. Restoring one is a person's call,
 * because that is the direction where being wrong reaches a guest.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const SUPPLY_HEALTH_ID = "supply-health";

/** A synced listing whose source has gone quiet this long is not trustworthy. */
const STALE_SYNC_HOURS = 48;

const surveyListings: AgentTool = {
  name: "survey_live_listings",
  description:
    "Look at every live listing and report what is wrong with it: missing price, description or image, or a synced listing whose source has gone quiet. Call this first.",
  schema: z.object({
    region: z.string().max(60).optional(),
  }),
  run: async (input, ctx) => {
    const listings = await prisma.operatorListing.findMany({
      where: {
        status: "LIVE",
        ...(input.region ? { region: { contains: input.region, mode: "insensitive" as const } } : {}),
      },
      select: {
        id: true,
        title: true,
        region: true,
        category: true,
        description: true,
        heroImageUrl: true,
        priceFrom: true,
        priceSignal: true,
        externalProductId: true,
        publishedAt: true,
        updatedAt: true,
        operatorProfile: { select: { companyName: true, status: true } },
      },
      take: 200,
    });

    const staleBefore = new Date(ctx.now.getTime() - STALE_SYNC_HOURS * 3_600_000);
    const problems = listings
      .map((l) => {
        const faults: string[] = [];
        if (!l.priceFrom && !l.priceSignal) faults.push("no price of any kind");
        if (!l.description || l.description.trim().length < 40) faults.push("description too thin to decide on");
        if (!l.heroImageUrl) faults.push("no image");
        if (!l.region?.trim()) faults.push("no region");
        // Only a synced listing can go stale. A hand-written one is as
        // current as the operator last made it, which is their business.
        if (l.externalProductId && l.updatedAt < staleBefore) {
          faults.push(
            `synced from their booking system but unchanged for ${Math.floor((ctx.now.getTime() - l.updatedAt.getTime()) / 3_600_000)}h, so the sync has probably stopped`,
          );
        }
        if (l.operatorProfile?.status === "DECLINED") faults.push("operator's application was declined but the listing is still live");
        return { listing: l, faults };
      })
      .filter((p) => p.faults.length > 0);

    ctx.outcome.surveyed = listings.length;
    ctx.outcome.problemCount = problems.length;

    if (problems.length === 0) {
      return `Looked at ${listings.length} live listings. Nothing wrong with any of them; end the turn.`;
    }

    return [
      `${problems.length} of ${listings.length} live listings have something wrong:`,
      "",
      ...problems.slice(0, 25).map((p) =>
        [
          `listing_id: ${p.listing.id}`,
          `title: ${p.listing.title}`,
          `operator: ${p.listing.operatorProfile?.companyName ?? "unknown"}`,
          `source: ${p.listing.externalProductId ? "synced" : "written by the operator"}`,
          `faults: ${p.faults.join("; ")}`,
        ].join(" · "),
      ),
    ].join("\n");
  },
};

const demoteListing: AgentTool = {
  name: "demote_listing",
  description:
    "Take a listing out of Discover by moving it back to draft. Use when a traveller could book something the operator may not be able to honour: a stopped sync, or no price at all. Do not use it for a thin description or a missing image, which are worth flagging but not worth hiding the trip over.",
  schema: z.object({
    listing_id: z.string().min(1),
    reason: z.string().max(300).describe("What a traveller would have hit. One sentence."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const listing = await prisma.operatorListing.findUnique({
      where: { id: input.listing_id },
      select: { id: true, title: true, status: true, operatorProfile: { select: { companyName: true } } },
    });
    if (!listing) return `No listing ${input.listing_id}.`;
    if (listing.status !== "LIVE") return `${listing.title} is already ${listing.status}. Nothing to do.`;

    await prisma.operatorListing.update({
      where: { id: listing.id },
      data: { status: "DRAFT" },
    });

    const demoted = (ctx.outcome.demoted as unknown[] | undefined) ?? [];
    ctx.outcome.demoted = [...demoted, { listingId: listing.id, title: listing.title, reason: input.reason }];
    ctx.log(`demoted ${listing.title}: ${input.reason}`);

    // Demoting protects the traveller immediately. Putting it back is the
    // part that needs a person, so it is raised rather than scheduled.
    const r = await ctx.requestDecision({
      kind: "listing.demoted",
      title: `Listing pulled from Discover: ${listing.title}`,
      summary: `${input.reason}\n\nOperator: ${listing.operatorProfile?.companyName ?? "unknown"}. It is back in draft and no traveller can book it. Restoring it is your call.`,
      payload: { listingId: listing.id, reason: input.reason },
      entityType: "OperatorListing",
      entityId: listing.id,
    });
    return `Demoted ${listing.title} to draft and raised it for a person (decision ${r.decisionId}).`;
  },
};

const reportProblems: AgentTool = {
  name: "report_listing_problems",
  description:
    "Record the problems that are worth someone fixing but not worth hiding the trip over: a thin description, a missing image. Call once, last, with everything you did not demote.",
  schema: z.object({
    problems: z
      .array(
        z.object({
          listing_id: z.string().min(1),
          title: z.string().max(200),
          fault: z.string().max(300),
        }),
      )
      .max(50),
  }),
  writes: true,
  run: async (input, ctx) => {
    ctx.outcome.reported = input.problems;
    if (input.problems.length === 0) return "Nothing further to report.";
    return `Recorded ${input.problems.length} listing problems for the operator dashboard to pick up.`;
  },
};

export const supplyHealthAgent: AgentDefinition = {
  id: SUPPLY_HEALTH_ID,
  name: "Supply health",
  desk: "supply",
  plane: "product",
  wave: 1,
  modelTier: "classification",
  persona: `You watch what travellers can actually see and book on BluePass, a marine-tourism marketplace in Australia and Indonesia.

Two kinds of wrong, and they get different treatment.

Wrong in a way a traveller would hit: a listing synced from an operator's booking system whose sync has stopped, or a listing with no price at all. Somebody could book a trip the operator does not know about or cannot honour. Demote those. A listing nobody can see costs BluePass a sale; a booking BluePass cannot deliver costs an operator their morning and a guest their trip, and those are not the same size of mistake.

Wrong in a way that only costs a sale: a thin description, a missing image. Report those. Do not demote a trip because its photo is missing. The operator is running boats, not a website, and hiding their listing over it helps nobody.

Judgement you are expected to use:
- A listing the operator wrote themselves cannot go stale. It is as current as they last made it, and that is their business, not yours.
- A stopped sync is usually BluePass's problem, not the operator's. Note it as such.
- If almost everything in the survey looks broken at once, that is a sync or a deploy failing, not two hundred operators all breaking on the same morning. Say so rather than demoting the whole catalogue.

Survey first, then act, then report what is left with report_listing_problems.`,
  triggers: [{ type: "schedule", cadence: "hourly" }, { type: "manual" }],
  tools: [surveyListings, demoteListing, reportProblems],
  gates: [{ kind: "listing.demoted", assignee: "kirby", defaultAction: "hold", ttlHours: 48 }],
  budget: { maxRunsPerDay: 24, maxTokensPerRun: 14_000, maxIterations: 30 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "a demoted listing was answered by a person" };
    const region = typeof payload.region === "string" ? payload.region : null;
    ctx.log("surveying live listings");
    return {
      task: `Check the health of the live listings${region ? ` in ${region}` : ""}.

Start with survey_live_listings. Demote only what a traveller could actually get burned by. Report the rest.`,
    };
  },
};
