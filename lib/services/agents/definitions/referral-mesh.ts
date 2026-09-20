/**
 * Agent 13 · Referral mesh (Wave 2).
 *
 * Catches the inquiry that would otherwise die. An operator declines, or
 * never answers, and a traveller who was ready to book is left holding
 * nothing. The mesh finds another operator who could take it.
 *
 * This is the one agent whose job is to act on a traveller's behalf across
 * operators, so two constraints shape it.
 *
 * It matches on what the traveller actually asked for, not on what is
 * convenient to fill. Sending a Komodo liveaboard enquiry to a Cairns day
 * boat because that operator has space is worse than sending nothing: it
 * wastes the traveller's time and teaches the operator that BluePass
 * referrals are noise.
 *
 * It never re-refers what a person is already handling, and it never
 * refers an inquiry an operator accepted. Both would put two operators in
 * front of one traveller, which is the failure that makes a marketplace
 * look disorganised in the only moment that counts.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const REFERRAL_MESH_ID = "referral-mesh";

/** An inquiry nobody has answered in this long is going cold. */
const STALE_HOURS = 48;

const findStranded: AgentTool = {
  name: "find_stranded_inquiries",
  description:
    "Find inquiries that are going nowhere: declined by the operator, or sitting unanswered past the point of being useful. Call this first.",
  schema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  run: async (input, ctx) => {
    const staleBefore = new Date(ctx.now.getTime() - STALE_HOURS * 3_600_000);

    const stranded = await prisma.bookingInquiry.findMany({
      where: {
        bookingId: null,
        OR: [
          { status: "OPERATOR_DECLINED" },
          { status: "OPERATOR_PENDING", updatedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: input.limit ?? 8,
      select: {
        id: true,
        status: true,
        destination: true,
        tripType: true,
        dateWindow: true,
        guests: true,
        certificationLevel: true,
        budget: true,
        notes: true,
        selectedYachtName: true,
        operatorId: true,
        updatedAt: true,
        createdAt: true,
        operator: { select: { id: true, name: true } },
      },
    });

    ctx.outcome.stranded = stranded.length;
    if (stranded.length === 0) {
      return "No stranded inquiries. Nothing to rescue; end the turn.";
    }

    return stranded
      .map((i) =>
        [
          `inquiry_id: ${i.id}`,
          `state: ${i.status}${i.status === "OPERATOR_PENDING" ? ` (unanswered ${Math.floor((ctx.now.getTime() - i.updatedAt.getTime()) / 3_600_000)}h)` : ""}`,
          `first operator: ${i.operator?.name ?? "none recorded"}`,
          `wants: ${i.destination ?? "destination not stated"} · ${i.tripType ?? "trip type not stated"}`,
          `when: ${i.dateWindow ?? "no dates given"}`,
          `guests: ${i.guests ?? "not stated"}`,
          `certification: ${i.certificationLevel ?? "not stated"}`,
          `budget: ${i.budget ?? "not stated"}`,
          i.notes ? `notes: ${i.notes.slice(0, 200)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      )
      .join("\n");
  },
};

const findCandidates: AgentTool = {
  name: "find_candidate_operators",
  description:
    "Find operators with live listings that could plausibly take this inquiry, by region and category. Returns only operators who are live and bookable. Never refer to an operator this did not return.",
  schema: z.object({
    region: z.string().max(80).describe("Where the traveller wants to go, in their words."),
    category: z.string().max(60).optional().describe("Dive, snorkel, liveaboard, charter, and so on."),
    exclude_operator_id: z.string().optional().describe("The operator who already declined or went quiet."),
  }),
  run: async (input, ctx) => {
    const listings = await prisma.operatorListing.findMany({
      where: {
        status: "LIVE",
        region: { contains: input.region, mode: "insensitive" as const },
        ...(input.category ? { category: { contains: input.category, mode: "insensitive" as const } } : {}),
      },
      select: {
        id: true,
        title: true,
        region: true,
        category: true,
        maxGuests: true,
        priceSignal: true,
        operatorProfile: {
          select: { id: true, companyName: true, claimedOperatorSlug: true, status: true },
        },
      },
      take: 40,
    });

    const usable = listings.filter(
      (l) => l.operatorProfile && l.operatorProfile.id !== input.exclude_operator_id,
    );
    ctx.outcome.candidates = usable.length;

    if (usable.length === 0) {
      return `No live, bookable operator in ${input.region}${input.category ? ` for ${input.category}` : ""}. Do not stretch the match to a different region or a different kind of trip. Record it as unreferrable and move on: a bad referral is worse than none.`;
    }

    return [
      `${usable.length} candidates in ${input.region}:`,
      ...usable.slice(0, 15).map((l) =>
        [
          `operator_profile_id: ${l.operatorProfile!.id}`,
          `name: ${l.operatorProfile!.companyName ?? "unnamed"}`,
          `listing: ${l.title}`,
          `category: ${l.category}`,
          `max guests: ${l.maxGuests ?? "not stated"}`,
          `price: ${l.priceSignal ?? "not shown"}`,
        ].join(" · "),
      ),
    ].join("\n");
  },
};

const refer: AgentTool = {
  name: "refer_inquiry",
  description:
    "Refer a stranded inquiry to another operator. Only to an operator find_candidate_operators returned, and only when the match is genuinely what the traveller asked for.",
  schema: z.object({
    inquiry_id: z.string().min(1),
    to_operator_profile_id: z.string().min(1),
    why_this_match: z
      .string()
      .max(400)
      .describe("What the traveller asked for and how this operator meets it. Specific, not generic."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const inquiry = await prisma.bookingInquiry.findUnique({
      where: { id: input.inquiry_id },
      select: { id: true, status: true, bookingId: true, operatorId: true, destination: true },
    });
    if (!inquiry) return `No inquiry ${input.inquiry_id}.`;

    // Two operators in front of one traveller is the failure that makes a
    // marketplace look disorganised in the only moment that counts.
    if (inquiry.bookingId) {
      return "Refused: this inquiry already became a booking. Referring it now would put a second operator in front of a traveller who is already sorted.";
    }
    if (inquiry.status === "OPERATOR_ACCEPTED") {
      return "Refused: an operator has accepted this. It is not stranded.";
    }
    if (inquiry.status === "COUNTER_OFFERED") {
      return "Refused: there is a live negotiation on this inquiry. A person is mid-conversation and a referral would cut across it.";
    }

    const target = await prisma.operatorProfile.findUnique({
      where: { id: input.to_operator_profile_id },
      select: { id: true, companyName: true, status: true },
    });
    if (!target) return `No operator profile ${input.to_operator_profile_id}.`;
    if (target.status !== "APPROVED" && target.status !== "LIVE") {
      return `Refused: ${target.companyName ?? "that operator"} is ${target.status}, not live. Only a live operator can take a referral.`;
    }

    // The event log records status transitions, so a referral is written
    // as the move to READY_TO_DISPATCH with the reasoning in the payload.
    // The status itself is not changed here: a person dispatches, and the
    // transition becomes real when they do.
    await prisma.bookingInquiryEvent.create({
      data: {
        bookingInquiryId: inquiry.id,
        fromStatus: inquiry.status,
        toStatus: "READY_TO_DISPATCH",
        actorType: "SYSTEM",
        payload: {
          event: "agent.referral_proposed",
          whyThisMatch: input.why_this_match,
          fromOperatorId: inquiry.operatorId,
          toOperatorProfileId: target.id,
          agentId: REFERRAL_MESH_ID,
          runId: ctx.runId,
        },
      },
    });

    const referred = (ctx.outcome.referred as unknown[] | undefined) ?? [];
    ctx.outcome.referred = [
      ...referred,
      { inquiryId: inquiry.id, to: target.companyName ?? target.id },
    ];
    ctx.log(`referred ${inquiry.id} to ${target.companyName ?? target.id}`);

    const r = await ctx.requestDecision({
      kind: "referral.proposed",
      title: `Refer a stranded enquiry to ${target.companyName ?? "another operator"}`,
      summary: [
        `${inquiry.destination ?? "An enquiry"} went nowhere with the first operator.`,
        "",
        input.why_this_match,
        "",
        "The match is recorded on the enquiry. Nothing has been sent to either operator or the traveller: dispatching it is yours.",
      ].join("\n"),
      payload: { inquiryId: inquiry.id, toOperatorProfileId: target.id },
      options: ["send it", "do not"],
      entityType: "BookingInquiry",
      entityId: inquiry.id,
    });

    return `Match recorded and put to a person (decision ${r.decisionId}). Nothing has been sent yet.`;
  },
};

const recordUnreferrable: AgentTool = {
  name: "record_unreferrable",
  description:
    "Record that a stranded inquiry has nowhere to go. Use this rather than stretching a match. It is the honest outcome when BluePass has no operator for what the traveller asked for.",
  schema: z.object({
    inquiry_id: z.string().min(1),
    why: z.string().max(300).describe("What they wanted and why nothing fits."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const inquiry = await prisma.bookingInquiry.findUnique({
      where: { id: input.inquiry_id },
      select: { status: true },
    });
    if (!inquiry) return `No inquiry ${input.inquiry_id}.`;
    // An annotation, not a transition: the status is unchanged, because
    // "nowhere to send this" is a fact about BluePass's supply rather than
    // a decision about the traveller's enquiry.
    await prisma.bookingInquiryEvent.create({
      data: {
        bookingInquiryId: input.inquiry_id,
        fromStatus: inquiry.status,
        toStatus: inquiry.status,
        actorType: "SYSTEM",
        payload: {
          event: "agent.unreferrable",
          why: input.why,
          agentId: REFERRAL_MESH_ID,
          runId: ctx.runId,
        },
      },
    });
    const gaps = (ctx.outcome.gaps as unknown[] | undefined) ?? [];
    ctx.outcome.gaps = [...gaps, { inquiryId: input.inquiry_id, why: input.why }];
    return "Recorded. This is supply BluePass does not have, which is worth knowing: it is the Scout's next region.";
  },
};

export const referralMeshAgent: AgentDefinition = {
  id: REFERRAL_MESH_ID,
  name: "Referral mesh",
  desk: "multipliers",
  plane: "product",
  wave: 2,
  modelTier: "reasoning",
  persona: `You rescue enquiries that are going nowhere on BluePass, a marine-tourism marketplace in Australia and Indonesia. An operator declined, or never answered, and a traveller who was ready to book is holding nothing.

Your job is to find another operator who could genuinely take it.

The word doing the work there is genuinely. Match on what the traveller actually asked for: the place, the kind of trip, the dates, the number of people, their certification if it matters. A Komodo liveaboard enquiry does not go to a Cairns day boat because that operator has space. That referral wastes the traveller's time, and it teaches the operator that BluePass referrals are not worth opening, which costs more than the one booking.

When nothing fits, say so with record_unreferrable. That is the correct answer, not a failure. It also tells BluePass something useful: an enquiry with nowhere to go is a gap in supply, and gaps are where the Scout should look next.

Only refer to an operator that find_candidate_operators returned. You cannot refer to an operator you remember, infer, or think probably exists.

You never dispatch. You record the match and a person sends it. That is deliberate: a referral arrives at a traveller who has already been let down once, and the second approach has to be right.

Never refer an enquiry that has become a booking, that an operator has accepted, or where a negotiation is live. Two operators in front of one traveller is the failure that makes a marketplace look disorganised in the only moment that counts.

Be specific in why_this_match. "Same region" is not a reason. "They run the same two-tank outer reef trip she asked about, take up to twelve, and have space that week" is.`,
  triggers: [
    { type: "schedule", cadence: "daily" },
    { type: "event", pattern: "inquiry.operator_declined" },
    { type: "manual" },
  ],
  tools: [findStranded, findCandidates, refer, recordUnreferrable],
  gates: [{ kind: "referral.proposed", assignee: "kirby", defaultAction: "hold", ttlHours: 24 }],
  budget: { maxRunsPerDay: 12, maxTokensPerRun: 16_000, maxIterations: 30 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "a person decided on a referral" };
    ctx.log("looking for stranded enquiries");
    return {
      task: `Rescue the enquiries that are going nowhere.

Start with find_stranded_inquiries. For each one, look for candidates on what the traveller actually asked for. Refer only a genuine match; where nothing fits, record it as unreferrable rather than stretching.`,
    };
  },
};
