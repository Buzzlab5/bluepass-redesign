/**
 * Agent 09 · Partner desk (Wave 2).
 *
 * Owns the people who send travellers to BluePass: dive shops, travel
 * agencies, trip leaders, instructors, creators. Reviews who applies,
 * issues them a tracked link, and reads whether the link ever does
 * anything.
 *
 * Two things shape this agent more than anything else.
 *
 * It never quotes a commission. Partner terms are agreed by a person, and a
 * figure in an automated message becomes the number the partner remembers
 * and holds BluePass to. It can say how the arrangement works; it cannot
 * say what it pays.
 *
 * It tells partners the truth about supply. Sending a partner to a thin
 * marketplace burns them once and they do not come back, so the honest
 * answer to "what can I sell" is whatever is actually bookable today.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { dispatch } from "../tools/dispatch";
import { verifyOutbound } from "./verifier";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const PARTNER_DESK_ID = "partner-desk";

/** A link issued this long ago with no clicks has not been used. */
const DORMANT_DAYS = 30;

const reviewApplications: AgentTool = {
  name: "list_partner_applications",
  description:
    "List partner applications waiting on review, with what they told BluePass about their audience. Call this first when reviewing.",
  schema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  run: async (input, ctx) => {
    const pending = await prisma.partnerProfile.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { createdAt: "asc" },
      take: input.limit ?? 8,
      select: {
        id: true,
        handle: true,
        partnerCategory: true,
        audienceUrl: true,
        instagramUrl: true,
        youtubeUrl: true,
        tiktokUrl: true,
        notes: true,
        createdAt: true,
        account: { select: { email: true, displayName: true, emailVerifiedAt: true } },
        referralPartner: { select: { id: true, name: true, role: true } },
      },
    });

    ctx.outcome.pending = pending.length;
    if (pending.length === 0) return "No partner applications waiting. Nothing to review.";

    return pending
      .map((p) =>
        [
          `profile_id: ${p.id}`,
          `name: ${p.account?.displayName ?? p.handle ?? "(none given)"}`,
          `email: ${p.account?.email ?? "none"}${p.account?.emailVerifiedAt ? "" : " (UNVERIFIED)"}`,
          `category: ${p.partnerCategory ?? "not stated"}`,
          `audience: ${[p.audienceUrl, p.instagramUrl, p.youtubeUrl, p.tiktokUrl].filter(Boolean).join(", ") || "nothing given"}`,
          `their note: ${p.notes?.slice(0, 200) ?? "none"}`,
          `linked partner record: ${p.referralPartner ? `${p.referralPartner.name} (${p.referralPartner.role})` : "none yet"}`,
        ].join(" · "),
      )
      .join("\n");
  },
};

const whatIsBookable: AgentTool = {
  name: "what_is_bookable",
  description:
    "What a partner could actually sell today: live listings by region and category. Call this before telling any partner what BluePass has, and never describe inventory this did not return.",
  schema: z.object({ region: z.string().max(60).optional() }),
  run: async (input) => {
    const listings = await prisma.operatorListing.findMany({
      where: {
        status: "LIVE",
        ...(input.region ? { region: { contains: input.region, mode: "insensitive" as const } } : {}),
      },
      select: { region: true, category: true, title: true },
      take: 300,
    });

    if (listings.length === 0) {
      return "Nothing is bookable right now. Do not tell a partner there is inventory. If they ask what they can sell, say BluePass is still onboarding operators and offer to come back to them when there is something worth sending people to.";
    }

    const byRegion = new Map<string, Map<string, number>>();
    for (const l of listings) {
      const r = l.region || "unknown";
      const c = l.category || "other";
      if (!byRegion.has(r)) byRegion.set(r, new Map());
      const m = byRegion.get(r)!;
      m.set(c, (m.get(c) ?? 0) + 1);
    }

    return [
      `${listings.length} bookable listings today:`,
      ...[...byRegion.entries()].map(
        ([region, cats]) =>
          `  ${region}: ${[...cats.entries()].map(([c, n]) => `${n} ${c}`).join(", ")}`,
      ),
      "",
      "That is the whole catalogue. Describe this and nothing more.",
    ].join("\n");
  },
};

const issueLink: AgentTool = {
  name: "issue_referral_link",
  description:
    "Approve a partner and issue their tracked link. Only after you have reviewed their application. The code must be readable and tied to them, not random.",
  schema: z.object({
    profile_id: z.string().min(1),
    code: z
      .string()
      .min(3)
      .max(40)
      .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and hyphens only")
      .describe("Readable and theirs, e.g. 'blue-horizon-dive'."),
    label: z.string().max(80).optional(),
  }),
  writes: true,
  run: async (input, ctx) => {
    const profile = await prisma.partnerProfile.findUnique({
      where: { id: input.profile_id },
      select: {
        id: true, status: true, handle: true, partnerCategory: true,
        referralPartnerId: true,
        account: { select: { email: true, displayName: true } },
      },
    });
    if (!profile) return `No partner profile ${input.profile_id}.`;
    if (profile.status !== "PENDING_REVIEW") {
      return `This partner is already ${profile.status}. Nothing to issue.`;
    }

    const taken = await prisma.referralLink.findUnique({ where: { code: input.code }, select: { id: true } });
    if (taken) return `The code "${input.code}" is already in use. Choose another.`;

    let partnerId = profile.referralPartnerId;
    if (!partnerId) {
      const created = await prisma.referralPartner.create({
        data: {
          role: "PARTNER",
          name: profile.account?.displayName ?? profile.handle ?? input.code,
          handle: profile.handle,
          email: profile.account?.email,
        },
        select: { id: true },
      });
      partnerId = created.id;
    }

    const link = await prisma.referralLink.create({
      data: { partnerId, code: input.code, label: input.label, active: true },
      select: { id: true, code: true },
    });
    await prisma.partnerProfile.update({
      where: { id: profile.id },
      data: { status: "APPROVED", referralPartnerId: partnerId },
    });

    const issued = (ctx.outcome.issued as unknown[] | undefined) ?? [];
    ctx.outcome.issued = [...issued, { profileId: profile.id, code: link.code }];
    ctx.log(`issued ${link.code}`);

    return `Approved and issued. Their link code is "${link.code}". Tell them how the arrangement works, never what it pays: terms are agreed with a person.`;
  },
};

const readLinkPerformance: AgentTool = {
  name: "read_link_performance",
  description:
    "How the issued links are actually doing: clicks, and which have never been used. Call this for the weekly read.",
  schema: z.object({}),
  run: async (_input, ctx) => {
    const links = await prisma.referralLink.findMany({
      where: { active: true },
      select: {
        id: true, code: true, createdAt: true,
        partner: { select: { name: true, email: true } },
        _count: { select: { clicks: true } },
      },
      take: 200,
    });

    if (links.length === 0) return "No active links. Nothing issued yet.";

    const dormantBefore = new Date(ctx.now.getTime() - DORMANT_DAYS * 86_400_000);
    const dormant = links.filter((l) => l._count.clicks === 0 && l.createdAt < dormantBefore);
    const working = links.filter((l) => l._count.clicks > 0).sort((a, b) => b._count.clicks - a._count.clicks);

    ctx.outcome.linkCount = links.length;
    ctx.outcome.dormant = dormant.length;

    return [
      `${links.length} active links.`,
      "",
      `USED (${working.length}):`,
      ...working.slice(0, 15).map((l) => `  ${l.code} · ${l.partner.name} · ${l._count.clicks} clicks`),
      "",
      `NEVER USED, issued over ${DORMANT_DAYS} days ago (${dormant.length}):`,
      ...dormant.slice(0, 15).map((l) => `  ${l.code} · ${l.partner.name} · issued ${l.createdAt.toISOString().slice(0, 10)}`),
      "",
      "A dormant link usually means the partner never had anything worth sending people to, or never understood what to do with it. Both are BluePass's problem, not theirs.",
    ].join("\n");
  },
};

const messagePartner: AgentTool = {
  name: "message_partner",
  description:
    "Write to a partner. The draft must have passed verify_outbound in this run. Never state a commission, a rate, or any percentage other than the fixed 5% of every booking that goes to ocean conservation.",
  schema: z.object({
    profile_id: z.string().min(1),
    subject: z.string().max(140).optional(),
    body: z.string().min(30).max(2000),
  }),
  writes: true,
  run: async (input, ctx) => {
    const verifications = (ctx.outcome.verifications as { pass: boolean }[] | undefined) ?? [];
    if (verifications.length === 0 || !verifications[verifications.length - 1].pass) {
      return "Refused: the copy rules have not passed on this message. Run verify_outbound on the exact text first.";
    }
    const profile = await prisma.partnerProfile.findUnique({
      where: { id: input.profile_id },
      select: { id: true, account: { select: { email: true, displayName: true } } },
    });
    if (!profile?.account?.email) return "No email on file for this partner.";

    const result = await dispatch({
      channel: "email",
      to: profile.account.email,
      subject: input.subject,
      body: input.body,
      reference: `partner:${profile.id}`,
    });
    return result.status === "sent"
      ? `Sent to ${profile.account.displayName ?? profile.account.email}.`
      : `Prepared for ${profile.account.displayName ?? profile.account.email}. ${result.reason}`;
  },
};

const escalatePartner: AgentTool = {
  name: "escalate_to_person",
  description:
    "Raise anything about terms, money, or a partner you are not confident approving. Terms are always a person's call.",
  schema: z.object({
    who: z.string().max(140),
    profile_id: z.string().min(1),
    what: z.string().max(500),
  }),
  writes: true,
  run: async (input, ctx) => {
    const r = await ctx.requestDecision({
      kind: "partner.needs_person",
      title: `${input.who}: needs you`,
      summary: input.what,
      payload: { profileId: input.profile_id },
      entityType: "PartnerProfile",
      entityId: input.profile_id,
    });
    return `Raised (decision ${r.decisionId}).`;
  },
};

export const partnerDeskAgent: AgentDefinition = {
  id: PARTNER_DESK_ID,
  name: "Partner desk",
  desk: "multipliers",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You run the partner desk for BluePass, a marine-tourism marketplace in Australia and Indonesia. Partners are the people who send travellers: dive shops, travel agencies, trip leaders, instructors and creators.

Three things govern everything you do.

You never state what a partner earns. Not a percentage, not a range, not "industry standard". Terms are agreed by a person, and a number in an automated message is the number a partner will remember and hold BluePass to for years. You can explain how the arrangement works: they get a tracked link, BluePass credits bookings that come through it, and terms are agreed directly. If they push for a figure, say a person will come back to them with it, and raise it with escalate_to_person.

You tell them the truth about supply. Call what_is_bookable before describing what BluePass has, and describe only that. A partner sent to a thin marketplace burns their own audience once and never sends a second one, and BluePass is not big enough to lose people that way. If there is nothing bookable in their region, say so and offer to come back when there is. That is a better first impression than an oversell.

You read whether a link ever gets used. A dormant link is almost never the partner being lazy. It usually means they had nothing worth sending people to, or nobody explained what to do with it. Both are BluePass's failures. Say that plainly rather than reporting partners as underperforming.

When reviewing an application, what you are looking for is whether this is a real audience of people who travel to dive, snorkel or get on the water. A small dive shop with four hundred genuine local customers is worth more than a large travel account with no marine audience. You are not scoring follower counts.

Rules you cannot bend:
- Run verify_outbound on the exact text before every message.
- The only percentage you may ever state is the fixed 5% of every booking that goes to ocean conservation.
- No emojis, no em dashes, no price-match promise.
- Never claim to be a person.`,
  triggers: [{ type: "schedule", cadence: "weekly" }, { type: "manual" }],
  tools: [reviewApplications, whatIsBookable, issueLink, readLinkPerformance, verifyOutbound, messagePartner, escalatePartner],
  gates: [{ kind: "partner.needs_person", assignee: "tony", defaultAction: "hold", ttlHours: 48 }],
  budget: { maxRunsPerDay: 6, maxTokensPerRun: 16_000, maxIterations: 36 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "a partner question was answered by a person" };
    ctx.log("working the partner desk");
    return {
      task: `Work the partner desk.

Review any waiting applications with list_partner_applications, approve and issue links to the ones that are a real marine-travel audience, then read how the existing links are doing with read_link_performance.

Before you describe BluePass's inventory to anyone, call what_is_bookable. Anything about terms or money goes to a person.`,
    };
  },
};
