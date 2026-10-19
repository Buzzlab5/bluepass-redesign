import type { CreatorCampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { creditBalance, CREDIT_CURRENCY, grantWelcomeCredit, splitCredit, type CreditBalance } from "@/lib/services/onboarding/credits";
import { FORMATS, matchCreators, specialtyLabel, type CreatorForMatch, type OperatorForMatch } from "@/lib/services/onboarding/creator-match";
import { claimedPreparedPage, loadPreparedPage } from "@/lib/services/operators/prepared-pages";
import { buildReferralShareUrl, buildUniqueReferralCode } from "@/lib/services/referrals/application-approval";

/**
 * An operator picks three creators to feature their trips, and their creator credit is
 * shared between them. A creator already on Bluepass sees the pick straight away and
 * accepts or declines it; one from the research list is invited by a person at Bluepass,
 * then sees it once they join. When a creator has shared their post the credit is theirs,
 * after a short window in which the operator can say it did not happen. A creator who
 * declines hands their share back, for the operator to give someone else.
 */

export const PICKS = 3;
export const REVIEW_DAYS = 7;
const ACTIVE: CreatorCampaignStatus[] = ["REQUESTED", "ACCEPTED", "FEATURED", "DISPUTED"];
const DAY = 24 * 60 * 60 * 1000;

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const STATES: Record<string, string> = {
  "new south wales": "NSW", victoria: "VIC", queensland: "QLD", "south australia": "SA", "western australia": "WA",
  tasmania: "TAS", "northern territory": "NT", "australian capital territory": "ACT",
};

/** "Cairns, QLD", "Queensland" or "QLD" read as a state code. */
export function stateCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const up = text.toUpperCase().match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/);
  if (up) return up[1];
  const name = Object.keys(STATES).find((n) => text.toLowerCase().includes(n));
  return name ? STATES[name] : null;
}

/** Who the operator is and what they run, from their prepared page or their own listings. */
async function operatorContext(accountId: string): Promise<{ name: string; path: string | null; match: OperatorForMatch }> {
  const prepared = await claimedPreparedPage(accountId);
  const loaded = prepared?.claimApproved ? await loadPreparedPage(prepared.slug, { preview: true }) : null;
  if (prepared && loaded) {
    return {
      name: loaded.page.name,
      path: `/operators/${prepared.slug}`,
      match: {
        state: stateCode(loaded.page.state), town: loaded.page.town ?? null, category: loaded.page.category, summary: loaded.page.summary,
        trips: loaded.trips.map((t) => ({ kind: t.trip.kind, title: t.trip.title, summary: t.trip.summary })),
      },
    };
  }
  const profile = await prisma.operatorProfile.findUnique({ where: { accountId }, select: { id: true, companyName: true, account: { select: { displayName: true } } } });
  const listings = profile
    ? await prisma.operatorListing.findMany({ where: { operatorProfileId: profile.id, status: { not: "ARCHIVED" } }, select: { title: true, category: true, region: true, description: true }, take: 40 })
    : [];
  return {
    name: profile?.companyName ?? profile?.account.displayName ?? "Your business",
    path: null,
    match: {
      state: stateCode(listings.map((l) => l.region).join(" ")), town: listings[0]?.region.split(",")[0]?.trim() ?? null,
      trips: listings.map((l) => ({ kind: l.category.toLowerCase(), title: l.title, summary: l.description })),
    },
  };
}

async function isApprovedOperator(accountId: string) {
  const profile = await prisma.operatorProfile.findUnique({ where: { accountId }, select: { status: true, country: true } });
  // The credit is in Australian dollars and the creators are Australian, so it is Australia's for now.
  return (profile?.status === "APPROVED" || profile?.status === "LIVE") && creatorCreditCountry(profile.country);
}

/** Creator credit and the creator directory are Australian; an operator with no country is an Australian one from before countries. */
export function creatorCreditCountry(country: string | null | undefined) {
  return !country || country.toUpperCase() === "AU";
}

function handleFrom(url: string | null | undefined) {
  if (!url) return null;
  const m = url.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  return m ? m[1] : url.replace(/^@/, "").trim() || null;
}

function slugify(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "creator";
}

/** Approved creator partners get a directory entry, so operators can pick them. */
export async function syncPartnerCreators() {
  const partners = await prisma.partnerProfile.findMany({
    where: { partnerCategory: "CREATOR", status: { in: ["APPROVED", "LIVE"] }, creator: null },
    select: { id: true, handle: true, instagramUrl: true, youtubeUrl: true, tiktokUrl: true, audienceUrl: true, account: { select: { displayName: true } } },
  });
  for (const p of partners) {
    const name = p.account.displayName ?? p.handle ?? "Creator";
    let slug = slugify(p.handle ?? name);
    if (await prisma.creator.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${p.id.slice(-5)}`;
    await prisma.creator.create({
      data: {
        slug, name, instagram: handleFrom(p.instagramUrl), youtube: p.youtubeUrl, tiktok: p.tiktokUrl, website: p.audienceUrl,
        source: "partner", partnerProfileId: p.id,
      },
    });
  }
}

export type CreatorChoice = {
  id: string; name: string; brand: string | null; instagram: string | null; website: string | null;
  base: string | null; specialties: string[]; reasons: string[]; joined: boolean;
};

export type CampaignView = {
  id: string; status: CreatorCampaignStatus; creditCents: number; currency: string; postUrl: string | null;
  featuredAt: Date | null; reviewEndsAt: Date | null;
  creator: { id: string; name: string; instagram: string | null; website: string | null; joined: boolean; invited: boolean };
};

function campaignView(c: {
  id: string; status: CreatorCampaignStatus; creditCents: number; currency: string; postUrl: string | null; featuredAt: Date | null;
  creator: { id: string; name: string; instagram: string | null; website: string | null; partnerProfileId: string | null; invitedAt: Date | null };
}): CampaignView {
  return {
    id: c.id, status: c.status, creditCents: c.creditCents, currency: c.currency, postUrl: c.postUrl, featuredAt: c.featuredAt,
    reviewEndsAt: c.featuredAt ? new Date(c.featuredAt.getTime() + REVIEW_DAYS * DAY) : null,
    creator: { id: c.creator.id, name: c.creator.name, instagram: c.creator.instagram, website: c.creator.website, joined: Boolean(c.creator.partnerProfileId), invited: Boolean(c.creator.invitedAt) },
  };
}

const CAMPAIGN_SELECT = {
  id: true, status: true, creditCents: true, currency: true, postUrl: true, featuredAt: true,
  creator: { select: { id: true, name: true, instagram: true, website: true, partnerProfileId: true, invitedAt: true } },
} as const;

/**
 * Everything the operator's creators screen needs: their credit (granted on first visit
 * once they are approved), the creators they picked, and the best twenty they have not.
 */
export async function creatorChoices(accountId: string, now = new Date()) {
  const approved = await isApprovedOperator(accountId);
  if (approved) await grantWelcomeCredit(accountId, now);
  await syncPartnerCreators();
  const [context, entries, campaigns, creators] = await Promise.all([
    operatorContext(accountId),
    prisma.operatorCreditEntry.findMany({ where: { operatorAccountId: accountId }, select: { kind: true, amountCents: true, expiresAt: true } }),
    prisma.creatorCampaign.findMany({ where: { operatorAccountId: accountId }, orderBy: { createdAt: "asc" }, select: CAMPAIGN_SELECT }),
    prisma.creator.findMany({ where: { hidden: false } }),
  ]);
  const picked = new Set(campaigns.filter((c) => ACTIVE.includes(c.status)).map((c) => c.creator.id));
  const candidates = creators.filter((c) => !picked.has(c.id)).map((c) => ({ ...c, joined: Boolean(c.partnerProfileId) }));
  const ranked = matchCreators<CreatorForMatch & (typeof candidates)[number]>(context.match, candidates, 20);
  const credit: CreditBalance = creditBalance(entries, now);
  return {
    approved,
    operator: { name: context.name, path: context.path },
    credit,
    picks: campaigns.map(campaignView),
    slotsLeft: Math.max(0, PICKS - picks(campaigns)),
    choices: ranked.map(({ creator: c, reasons, shared }): CreatorChoice => ({
      id: c.id, name: c.name, brand: c.brand, instagram: c.instagram, website: c.website,
      base: [c.baseTown, c.baseState].filter(Boolean).join(", ") || null,
      // What they share with the operator comes first, so the chips back up the reason above them.
      specialties: [...shared, ...c.specialties.filter((s) => !shared.includes(s) && !FORMATS.has(s))].slice(0, 3).map(specialtyLabel),
      reasons, joined: c.joined,
    })),
  };
}

function picks(campaigns: { status: CreatorCampaignStatus }[]) {
  return campaigns.filter((c) => ACTIVE.includes(c.status)).length;
}

/** The operator's picks, each with an equal share of the credit they have left. */
export async function pickCreators(input: { accountId: string; creatorIds: string[]; now?: Date }): Promise<Result<{ campaigns: CampaignView[] }>> {
  const now = input.now ?? new Date();
  if (!(await isApprovedOperator(input.accountId))) return { ok: false, message: "You can pick creators once your business is approved." };
  const ids = [...new Set(input.creatorIds)];
  if (!ids.length) return { ok: false, message: "Pick at least one creator." };

  const [entries, campaigns, creators, context] = await Promise.all([
    prisma.operatorCreditEntry.findMany({ where: { operatorAccountId: input.accountId }, select: { kind: true, amountCents: true, expiresAt: true } }),
    prisma.creatorCampaign.findMany({ where: { operatorAccountId: input.accountId }, select: { status: true, creatorId: true } }),
    prisma.creator.findMany({ where: { id: { in: ids }, hidden: false }, select: { id: true } }),
    operatorContext(input.accountId),
  ]);
  const slotsLeft = PICKS - picks(campaigns);
  if (ids.length > slotsLeft) return { ok: false, message: slotsLeft ? `You can pick ${slotsLeft} more.` : "You already have three creators." };
  if (creators.length !== ids.length) return { ok: false, message: "One of those creators is no longer available. Pick again." };
  if (campaigns.some((c) => ids.includes(c.creatorId) && ACTIVE.includes(c.status))) return { ok: false, message: "You have already picked that creator." };
  const credit = creditBalance(entries, now);
  if (credit.availableCents <= 0) return { ok: false, message: credit.expired ? "Your creator credit has expired." : "You have no creator credit left to share." };

  const shares = splitCredit(credit.availableCents, slotsLeft).slice(0, ids.length);
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const [i, creatorId] of ids.entries()) {
      // A creator picked before and then declined or cancelled is picked again on the same row.
      const campaign = await tx.creatorCampaign.upsert({
        where: { operatorAccountId_creatorId: { operatorAccountId: input.accountId, creatorId } },
        create: { operatorAccountId: input.accountId, creatorId, operatorName: context.name, operatorPath: context.path, creditCents: shares[i], currency: CREDIT_CURRENCY, createdAt: now },
        update: { status: "REQUESTED", creditCents: shares[i], respondedAt: null, featuredAt: null, disputedAt: null, postUrl: null, referralLinkId: null },
        select: CAMPAIGN_SELECT,
      });
      await tx.operatorCreditEntry.create({
        data: { operatorAccountId: input.accountId, kind: "CAMPAIGN_HOLD", amountCents: -shares[i], currency: CREDIT_CURRENCY, campaignId: campaign.id, onceKey: `hold:${campaign.id}:${now.getTime()}`, createdAt: now },
      });
      out.push(campaignView(campaign));
    }
    return out;
  });
  return { ok: true, campaigns: created };
}

async function release(campaignId: string, accountId: string, cents: number, now: Date) {
  await prisma.operatorCreditEntry.create({
    data: { operatorAccountId: accountId, kind: "CAMPAIGN_RELEASE", amountCents: cents, currency: CREDIT_CURRENCY, campaignId, onceKey: `release:${campaignId}:${now.getTime()}`, createdAt: now },
  });
}

/** The operator takes back a pick nobody has answered yet; its credit returns to them. */
export async function cancelPick(input: { accountId: string; campaignId: string; now?: Date }): Promise<Result> {
  const now = input.now ?? new Date();
  const done = await prisma.creatorCampaign.updateMany({
    where: { id: input.campaignId, operatorAccountId: input.accountId, status: "REQUESTED" },
    data: { status: "CANCELLED", respondedAt: now },
  });
  if (!done.count) return { ok: false, message: "Only a pick the creator has not answered yet can be taken back." };
  const c = await prisma.creatorCampaign.findUniqueOrThrow({ where: { id: input.campaignId }, select: { creditCents: true } });
  await release(input.campaignId, input.accountId, c.creditCents, now);
  return { ok: true };
}

/** The operator says a creator's post did not feature them; a person looks before the credit moves. */
export async function reportNotFeatured(input: { accountId: string; campaignId: string; now?: Date }): Promise<Result> {
  const now = input.now ?? new Date();
  const c = await prisma.creatorCampaign.findFirst({ where: { id: input.campaignId, operatorAccountId: input.accountId }, select: { status: true, featuredAt: true } });
  if (!c || c.status !== "FEATURED" || !c.featuredAt) return { ok: false, message: "That creator has not shared a post yet." };
  if (now.getTime() > c.featuredAt.getTime() + REVIEW_DAYS * DAY) return { ok: false, message: `Posts can be questioned for ${REVIEW_DAYS} days after they are shared.` };
  await prisma.creatorCampaign.update({ where: { id: input.campaignId }, data: { status: "DISPUTED", disputedAt: now } });
  return { ok: true };
}

/** The picks waiting on, or already with, a creator who has a Bluepass account. */
export async function campaignsForCreator(partnerProfileId: string) {
  const creator = await prisma.creator.findUnique({ where: { partnerProfileId }, select: { id: true } });
  if (!creator) return [];
  const rows = await prisma.creatorCampaign.findMany({
    where: { creatorId: creator.id, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, operatorName: true, operatorPath: true, creditCents: true, currency: true, postUrl: true, featuredAt: true, referralLinkId: true, createdAt: true },
  });
  const links = await prisma.referralLink.findMany({ where: { id: { in: rows.map((r) => r.referralLinkId).filter((id): id is string => Boolean(id)) } }, select: { id: true, code: true, targetPath: true } });
  return rows.map((r) => {
    const link = links.find((l) => l.id === r.referralLinkId);
    return { ...r, shareUrl: link ? buildReferralShareUrl(link.code, link.targetPath) ?? null : null };
  });
}

async function creatorCampaign(partnerProfileId: string, campaignId: string) {
  const creator = await prisma.creator.findUnique({ where: { partnerProfileId }, select: { id: true, slug: true } });
  if (!creator) return null;
  const campaign = await prisma.creatorCampaign.findFirst({ where: { id: campaignId, creatorId: creator.id } });
  return campaign ? { creator, campaign } : null;
}

/** A creator accepts or declines a pick. Accepting gives them a tracked link to the operator's page. */
export async function respondToPick(input: { partnerProfileId: string; campaignId: string; accept: boolean; now?: Date }): Promise<Result> {
  const now = input.now ?? new Date();
  const found = await creatorCampaign(input.partnerProfileId, input.campaignId);
  if (!found || found.campaign.status !== "REQUESTED") return { ok: false, message: "That request is no longer open." };
  const { creator, campaign } = found;
  if (!input.accept) {
    await prisma.creatorCampaign.update({ where: { id: campaign.id }, data: { status: "DECLINED", respondedAt: now } });
    await release(campaign.id, campaign.operatorAccountId, campaign.creditCents, now);
    return { ok: true };
  }
  const partner = await prisma.partnerProfile.findUnique({ where: { id: input.partnerProfileId }, select: { referralPartnerId: true } });
  if (!partner?.referralPartnerId) return { ok: false, message: "Your creator account is not set up for links yet. Ask Bluepass to finish it." };
  const link = await prisma.referralLink.create({
    data: {
      partnerId: partner.referralPartnerId,
      code: await buildUniqueReferralCode(`${creator.slug}-${slugify(campaign.operatorName)}`),
      label: campaign.operatorName,
      targetPath: campaign.operatorPath ?? "/",
    },
  });
  await prisma.creatorCampaign.update({ where: { id: campaign.id }, data: { status: "ACCEPTED", respondedAt: now, referralLinkId: link.id } });
  return { ok: true };
}

/** A creator shares the post that features the operator. */
export async function markFeatured(input: { partnerProfileId: string; campaignId: string; postUrl: string; now?: Date }): Promise<Result> {
  const now = input.now ?? new Date();
  let url: URL;
  try {
    url = new URL(input.postUrl.trim());
  } catch {
    return { ok: false, message: "Paste the full link to your post." };
  }
  if (url.protocol !== "https:") return { ok: false, message: "Paste the full link to your post." };
  const found = await creatorCampaign(input.partnerProfileId, input.campaignId);
  if (!found || found.campaign.status !== "ACCEPTED") return { ok: false, message: "Accept the request before sharing your post." };
  await prisma.creatorCampaign.update({ where: { id: found.campaign.id }, data: { status: "FEATURED", featuredAt: now, postUrl: url.toString() } });
  return { ok: true };
}

/**
 * What a creator has earned from features, by currency: each featured pick's credit once
 * its review window has passed without the operator questioning it.
 */
export async function creatorCampaignEarnings(referralPartnerId: string, now = new Date()): Promise<Record<string, number>> {
  const rows = await prisma.creatorCampaign.findMany({
    where: { status: "FEATURED", featuredAt: { lte: new Date(now.getTime() - REVIEW_DAYS * DAY) }, creator: { partnerProfile: { referralPartnerId } } },
    select: { creditCents: true, currency: true },
  });
  return rows.reduce<Record<string, number>>((sum, r) => ({ ...sum, [r.currency]: (sum[r.currency] ?? 0) + r.creditCents }), {});
}

/** For the dashboard: credit the operator has not yet shared, counting a grant not yet collected. */
export async function creatorCreditPrompt(accountId: string, now = new Date()) {
  if (!(await isApprovedOperator(accountId))) return null;
  const [entries, campaigns] = await Promise.all([
    prisma.operatorCreditEntry.findMany({ where: { operatorAccountId: accountId }, select: { kind: true, amountCents: true, expiresAt: true } }),
    prisma.creatorCampaign.findMany({ where: { operatorAccountId: accountId }, select: { status: true } }),
  ]);
  const credit = creditBalance(entries, now);
  const availableCents = entries.length ? credit.availableCents : 10_000;
  const slotsLeft = PICKS - picks(campaigns);
  return availableCents > 0 && slotsLeft > 0 ? { availableCents, slotsLeft } : null;
}
