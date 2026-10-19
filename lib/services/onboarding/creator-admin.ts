import { prisma } from "@/lib/db/prisma";
import { CREDIT_CURRENCY } from "@/lib/services/onboarding/credits";
import { stopOutreachQuietly } from "@/lib/services/outreach/stop";

/**
 * What the Bluepass team does in creator onboarding: see which picked creators still have no
 * invite (most get one email through Instantly; an Instagram message stays by hand), link a
 * creator to their account when it is not obvious, and settle a post an operator questioned.
 */

/** Researched creators that operators picked and nobody has invited yet, most wanted first. */
export async function invitesToSend() {
  const creators = await prisma.creator.findMany({
    where: { partnerProfileId: null, hidden: false, campaigns: { some: { status: "REQUESTED" } } },
    include: {
      campaigns: { where: { status: "REQUESTED" }, select: { operatorName: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      enrolments: { select: { status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return creators
    .map((c) => ({
      id: c.id, name: c.name, brand: c.brand, website: c.website, instagram: c.instagram, contactEmail: c.contactEmail,
      base: [c.baseTown, c.baseState].filter(Boolean).join(", ") || null, invitedAt: c.invitedAt, invitedBy: c.invitedBy,
      pickedBy: c.campaigns.map((p) => p.operatorName), firstPickedAt: c.campaigns[0]?.createdAt ?? null,
      emailed: c.enrolments[0] ? { at: c.enrolments[0].createdAt, status: c.enrolments[0].status } : null,
    }))
    .sort((a, b) => Number(Boolean(a.invitedAt)) - Number(Boolean(b.invitedAt)) || b.pickedBy.length - a.pickedBy.length);
}

export async function markInvited(input: { creatorId: string; by: string; now?: Date }) {
  await prisma.creator.update({ where: { id: input.creatorId }, data: { invitedAt: input.now ?? new Date(), invitedBy: input.by } });
}

/** Creators with an approved creator account who are not yet tied to a researched creator. */
export async function linkableCreatorAccounts() {
  const partners = await prisma.partnerProfile.findMany({
    where: { partnerCategory: "CREATOR", status: { in: ["APPROVED", "LIVE"] } },
    select: { id: true, handle: true, account: { select: { email: true, displayName: true } }, creator: { select: { id: true, source: true, _count: { select: { campaigns: true } } } } },
  });
  // A creator account's own entry, made when it was approved, can be replaced while nobody has picked it.
  return partners
    .filter((p) => !p.creator || (p.creator.source === "partner" && p.creator._count.campaigns === 0))
    .map((p) => ({ id: p.id, label: [p.account.displayName ?? p.handle, p.account.email].filter(Boolean).join(" · ") }));
}

/**
 * Ties a researched creator to the account they signed up with, so the picks waiting for
 * them appear in their portal. The account's own placeholder entry, unpicked, gives way.
 */
export async function linkCreatorAccount(input: { creatorId: string; partnerProfileId: string }) {
  const own = await prisma.creator.findUnique({ where: { partnerProfileId: input.partnerProfileId }, include: { _count: { select: { campaigns: true } } } });
  if (own && own.id !== input.creatorId) {
    if (own._count.campaigns > 0 || own.source !== "partner") return { ok: false as const, message: "That account is already tied to a creator operators have picked." };
    await prisma.creator.delete({ where: { id: own.id } });
  }
  await prisma.creator.update({ where: { id: input.creatorId }, data: { partnerProfileId: input.partnerProfileId } });
  // They joined, which is all the invite emails asked for.
  await stopOutreachQuietly({ creatorId: input.creatorId }, "joined Bluepass as a creator");
  return { ok: true as const };
}

function handleOf(url: string | null | undefined) {
  const m = url?.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  return (m ? m[1] : url ?? "").replace(/^@/, "").replace(/\/$/, "").trim().toLowerCase() || null;
}

/**
 * When a creator's partner application is approved, ties it to the researched creator it
 * plainly is: the same email as the one on their site, or the same Instagram account. Anything
 * less certain is left for a person in /admin/creators.
 */
export async function autoLinkCreator(partnerProfileId: string) {
  const partner = await prisma.partnerProfile.findUnique({
    where: { id: partnerProfileId },
    select: { partnerCategory: true, instagramUrl: true, account: { select: { email: true } }, creator: { select: { source: true } } },
  });
  if (!partner || partner.partnerCategory !== "CREATOR" || partner.creator?.source === "research") return { linked: false as const };
  const email = partner.account.email.trim().toLowerCase();
  const handle = handleOf(partner.instagramUrl);
  const matches = await prisma.creator.findMany({
    where: {
      source: "research", partnerProfileId: null,
      OR: [{ contactEmail: { equals: email, mode: "insensitive" } }, ...(handle ? [{ instagram: { equals: handle, mode: "insensitive" as const } }] : [])],
    },
    select: { id: true },
  });
  if (matches.length !== 1) return { linked: false as const };
  const done = await linkCreatorAccount({ creatorId: matches[0].id, partnerProfileId });
  return { linked: done.ok, creatorId: matches[0].id };
}

/** Posts an operator said did not feature them. */
export async function disputedPosts() {
  return prisma.creatorCampaign.findMany({
    where: { status: "DISPUTED" },
    orderBy: { disputedAt: "asc" },
    select: { id: true, operatorName: true, postUrl: true, creditCents: true, currency: true, disputedAt: true, creator: { select: { name: true } } },
  });
}

/**
 * Settles a questioned post: paid, the credit goes to the creator as though never questioned;
 * not paid, the pick ends and the credit returns to the operator.
 */
export async function resolveDispute(input: { campaignId: string; pay: boolean; now?: Date }) {
  const now = input.now ?? new Date();
  const campaign = await prisma.creatorCampaign.findFirst({ where: { id: input.campaignId, status: "DISPUTED" } });
  if (!campaign) return { ok: false as const, message: "That post is no longer in question." };
  if (input.pay) {
    await prisma.creatorCampaign.update({ where: { id: campaign.id }, data: { status: "FEATURED" } });
    return { ok: true as const };
  }
  await prisma.$transaction([
    prisma.creatorCampaign.update({ where: { id: campaign.id }, data: { status: "CANCELLED" } }),
    prisma.operatorCreditEntry.create({
      data: { operatorAccountId: campaign.operatorAccountId, kind: "CAMPAIGN_RELEASE", amountCents: campaign.creditCents, currency: CREDIT_CURRENCY, campaignId: campaign.id, onceKey: `release:${campaign.id}:${now.getTime()}`, createdAt: now },
    }),
  ]);
  return { ok: true as const };
}

export async function creatorDirectoryCounts() {
  const [total, joined, invited, picks] = await Promise.all([
    prisma.creator.count({ where: { hidden: false } }),
    prisma.creator.count({ where: { hidden: false, partnerProfileId: { not: null } } }),
    prisma.creator.count({ where: { invitedAt: { not: null } } }),
    prisma.creatorCampaign.groupBy({ by: ["status"], _count: true }),
  ]);
  return { total, joined, invited, picks: Object.fromEntries(picks.map((p) => [p.status, p._count])) as Record<string, number> };
}
