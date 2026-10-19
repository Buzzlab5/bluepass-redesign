import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  cancelPick, campaignsForCreator, creatorCampaignEarnings, creatorChoices, markFeatured, pickCreators, reportNotFeatured, respondToPick,
} from "@/lib/services/onboarding/creator-campaigns";
import { disputedPosts, invitesToSend, linkableCreatorAccounts, linkCreatorAccount, markInvited, resolveDispute } from "@/lib/services/onboarding/creator-admin";
import { loadCredit } from "@/lib/services/onboarding/credits";
import { getRequestablePartnerBalance } from "@/lib/services/partner/payout-requests";
import { resetRailsTables, seedOperator } from "@/lib/services/rails/test-fixtures";

/**
 * An operator picks three creators and their A$100 credit is shared between them. A
 * creator on Bluepass accepts or declines; a decline hands the share back for another
 * pick; a feature becomes the creator's money once the operator's review window passes.
 */

const now = new Date("2026-10-19T00:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
const NO_AU_LEDGER = async () => [];

async function researchCreator(slug: string, more: object = {}) {
  return prisma.creator.create({ data: { slug, name: slug.replace(/-/g, " "), source: "research", baseState: "QLD", specialties: ["reef", "dive"], ...more } });
}

async function joinedCreator(slug: string) {
  const account = await prisma.bluePassAccount.create({ data: { email: `${slug}@creators.test`, passwordHash: "x", roles: ["PARTNER"], displayName: slug } });
  const partner = await prisma.referralPartner.create({ data: { role: "PARTNER", name: slug, email: `${slug}@creators.test` } });
  const profile = await prisma.partnerProfile.create({
    data: { accountId: account.id, referralPartnerId: partner.id, status: "APPROVED", partnerCategory: "CREATOR", handle: slug, instagramUrl: `https://www.instagram.com/${slug}/` },
  });
  return { profile, partner };
}

beforeEach(async () => {
  await resetRailsTables();
  await prisma.$executeRawUnsafe(`TRUNCATE "Creator", "CreatorCampaign", "OperatorCreditEntry", "PartnerProfile", "ReferralPartner", "ReferralLink" CASCADE`);
});

describe("an operator picking creators", () => {
  it("gives the credit on arrival, offers matched creators, and shares the credit between three picks", async () => {
    const { account } = await seedOperator();
    const [a, b, c] = await Promise.all(["reef-one", "reef-two", "reef-three"].map((s) => researchCreator(s)));
    await researchCreator("tas-surfer", { baseState: "TAS", specialties: ["surf"] });

    const before = await creatorChoices(account.id, now);
    expect(before.credit).toMatchObject({ availableCents: 10_000 });
    expect(before.choices.map((x) => x.name)).toContain("reef one");
    expect(before.slotsLeft).toBe(3);

    expect(await pickCreators({ accountId: account.id, creatorIds: [a.id, b.id, c.id], now })).toMatchObject({ ok: true });
    const after = await creatorChoices(account.id, now);
    expect(after.picks.map((p) => p.creditCents).sort((x, y) => y - x)).toEqual([3_334, 3_333, 3_333]);
    expect(after.credit.availableCents).toBe(0);
    expect(after.slotsLeft).toBe(0);
    expect(after.choices.map((x) => x.id)).not.toContain(a.id);
  });

  it("will not pick more than three, the same creator twice, or before the business is approved", async () => {
    const { account, profile } = await seedOperator();
    const creators = await Promise.all(["a1", "a2", "a3", "a4"].map((s) => researchCreator(s)));
    await creatorChoices(account.id, now);
    expect(await pickCreators({ accountId: account.id, creatorIds: creators.map((c) => c.id), now })).toMatchObject({ ok: false, message: "You can pick 3 more." });
    await pickCreators({ accountId: account.id, creatorIds: [creators[0].id], now });
    expect(await pickCreators({ accountId: account.id, creatorIds: [creators[0].id], now })).toMatchObject({ ok: false });

    await prisma.operatorProfile.update({ where: { id: profile.id }, data: { status: "PENDING_REVIEW" } });
    expect(await pickCreators({ accountId: account.id, creatorIds: [creators[1].id], now })).toMatchObject({ ok: false, message: expect.stringContaining("approved") });
  });

  it("returns a share when a pick is taken back, for another creator", async () => {
    const { account } = await seedOperator();
    const [a, b] = await Promise.all(["b1", "b2"].map((s) => researchCreator(s)));
    await creatorChoices(account.id, now);
    const picked = await pickCreators({ accountId: account.id, creatorIds: [a.id], now });
    if (!picked.ok) throw new Error(picked.message);
    expect((await loadCredit(account.id, now)).availableCents).toBe(6_666);
    expect(await cancelPick({ accountId: account.id, campaignId: picked.campaigns[0].id, now })).toMatchObject({ ok: true });
    expect((await loadCredit(account.id, now)).availableCents).toBe(10_000);
    expect(await pickCreators({ accountId: account.id, creatorIds: [b.id], now: days(1) })).toMatchObject({ ok: true });
  });
});

describe("a creator answering a pick", () => {
  it("accepts, gets a tracked link to the operator, shares the post, and is paid after the review window", async () => {
    const { account } = await seedOperator();
    const { profile, partner } = await joinedCreator("reef-filmer");
    const choices = await creatorChoices(account.id, now);
    const creator = choices.choices.find((c) => c.joined);
    expect(creator?.name).toBe("reef-filmer");
    const picked = await pickCreators({ accountId: account.id, creatorIds: [creator!.id], now });
    if (!picked.ok) throw new Error(picked.message);
    const id = picked.campaigns[0].id;

    expect(await markFeatured({ partnerProfileId: profile.id, campaignId: id, postUrl: "https://example.test/p/1", now })).toMatchObject({ ok: false });
    expect(await respondToPick({ partnerProfileId: profile.id, campaignId: id, accept: true, now })).toEqual({ ok: true });
    const [open] = await campaignsForCreator(profile.id);
    expect(open).toMatchObject({ status: "ACCEPTED", operatorName: "Reef Runner Charters", creditCents: 3_334 });
    expect(open.shareUrl).toContain("ref=");

    expect(await markFeatured({ partnerProfileId: profile.id, campaignId: id, postUrl: "not a link", now: days(2) })).toMatchObject({ ok: false });
    expect(await markFeatured({ partnerProfileId: profile.id, campaignId: id, postUrl: "https://example.test/p/1", now: days(2) })).toEqual({ ok: true });
    expect(await creatorCampaignEarnings(partner.id, days(5))).toEqual({});
    expect(await creatorCampaignEarnings(partner.id, days(10))).toEqual({ AUD: 3_334 });
  });

  it("hands the share back to the operator when declining", async () => {
    const { account } = await seedOperator();
    const { profile } = await joinedCreator("busy-creator");
    await creatorChoices(account.id, now);
    const creator = await prisma.creator.findUniqueOrThrow({ where: { partnerProfileId: profile.id } });
    const picked = await pickCreators({ accountId: account.id, creatorIds: [creator.id], now });
    if (!picked.ok) throw new Error(picked.message);
    expect(await respondToPick({ partnerProfileId: profile.id, campaignId: picked.campaigns[0].id, accept: false, now })).toEqual({ ok: true });
    expect((await loadCredit(account.id, now)).availableCents).toBe(10_000);
    expect(await respondToPick({ partnerProfileId: profile.id, campaignId: picked.campaigns[0].id, accept: true, now })).toMatchObject({ ok: false });
  });

  it("holds the credit back when the operator says the post did not feature them", async () => {
    const { account } = await seedOperator();
    const { profile, partner } = await joinedCreator("doubtful-post");
    await creatorChoices(account.id, now);
    const creator = await prisma.creator.findUniqueOrThrow({ where: { partnerProfileId: profile.id } });
    const picked = await pickCreators({ accountId: account.id, creatorIds: [creator.id], now });
    if (!picked.ok) throw new Error(picked.message);
    const id = picked.campaigns[0].id;
    await respondToPick({ partnerProfileId: profile.id, campaignId: id, accept: true, now });
    await markFeatured({ partnerProfileId: profile.id, campaignId: id, postUrl: "https://example.test/p/2", now });
    expect(await reportNotFeatured({ accountId: account.id, campaignId: id, now: days(3) })).toEqual({ ok: true });
    expect(await creatorCampaignEarnings(partner.id, days(30))).toEqual({});
  });

  it("counts featured credit in what a creator can ask to be paid", async () => {
    const { account } = await seedOperator();
    const { profile, partner } = await joinedCreator("paid-creator");
    await creatorChoices(account.id, now);
    const creator = await prisma.creator.findUniqueOrThrow({ where: { partnerProfileId: profile.id } });
    const picked = await pickCreators({ accountId: account.id, creatorIds: [creator.id], now });
    if (!picked.ok) throw new Error(picked.message);
    await respondToPick({ partnerProfileId: profile.id, campaignId: picked.campaigns[0].id, accept: true, now });
    await markFeatured({ partnerProfileId: profile.id, campaignId: picked.campaigns[0].id, postUrl: "https://example.test/p/3", now: days(-10) });
    const balances = await getRequestablePartnerBalance(partner.id, NO_AU_LEDGER);
    // One pick of three is a third of the credit; under the payout minimum on its own.
    expect(balances).toContainEqual(expect.objectContaining({ currency: "AUD", accruedCents: 3_334, availableCents: 3_334, canRequest: false }));
  });
});

describe("the Bluepass team's side", () => {
  it("lists picked creators to invite, and once linked to their new account the picks reach their portal", async () => {
    const { account } = await seedOperator();
    const researched = await researchCreator("reef-photographer", { website: "https://reef.test" });
    await creatorChoices(account.id, now);
    await pickCreators({ accountId: account.id, creatorIds: [researched.id], now });

    const [invite] = await invitesToSend();
    expect(invite).toMatchObject({ name: "reef photographer", pickedBy: ["Reef Runner Charters"], invitedAt: null });
    await markInvited({ creatorId: researched.id, by: "team@bluepass.test", now });
    expect((await invitesToSend())[0].invitedBy).toBe("team@bluepass.test");

    // They sign up and are approved; approval gives them a placeholder entry, which linking replaces.
    const { profile } = await joinedCreator("reef-photographer-account");
    await creatorChoices(account.id, now);
    expect(await linkableCreatorAccounts()).toContainEqual(expect.objectContaining({ id: profile.id }));
    expect(await linkCreatorAccount({ creatorId: researched.id, partnerProfileId: profile.id })).toEqual({ ok: true });
    expect((await campaignsForCreator(profile.id)).map((c) => c.operatorName)).toEqual(["Reef Runner Charters"]);
    expect(await invitesToSend()).toEqual([]);
  });

  it("settles a questioned post either way", async () => {
    const { account } = await seedOperator();
    const { profile, partner } = await joinedCreator("questioned");
    await creatorChoices(account.id, now);
    const creator = await prisma.creator.findUniqueOrThrow({ where: { partnerProfileId: profile.id } });
    const picked = await pickCreators({ accountId: account.id, creatorIds: [creator.id], now });
    if (!picked.ok) throw new Error(picked.message);
    const id = picked.campaigns[0].id;
    await respondToPick({ partnerProfileId: profile.id, campaignId: id, accept: true, now });
    await markFeatured({ partnerProfileId: profile.id, campaignId: id, postUrl: "https://example.test/p/9", now });
    await reportNotFeatured({ accountId: account.id, campaignId: id, now: days(1) });
    expect((await disputedPosts()).map((d) => d.id)).toEqual([id]);

    expect(await resolveDispute({ campaignId: id, pay: false, now: days(2) })).toEqual({ ok: true });
    expect((await loadCredit(account.id, days(2))).availableCents).toBe(10_000);
    expect(await creatorCampaignEarnings(partner.id, days(30))).toEqual({});
    expect(await resolveDispute({ campaignId: id, pay: true })).toMatchObject({ ok: false });
  });
});
