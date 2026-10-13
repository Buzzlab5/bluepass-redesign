import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { requestOperatorClaimToken } from "@/lib/services/operators/operator-claim-tokens";
import { claimPreparedPage, reviewForClaim } from "@/lib/services/operators/prepared-claim";
import { importPreparedOperator, loadPreparedPage, type PreparedOperator } from "@/lib/services/operators/prepared-pages";
import { resetRailsTables } from "@/lib/services/rails/test-fixtures";

/**
 * One press from the emailed link: the person at the business address sees their page,
 * claims it, and it goes live with the photos they saw. The link is the only proof
 * asked for, so it has to be spent once and refuse anything odd.
 */

const page: PreparedOperator = {
  slug: "reef-co",
  name: "Reef Co",
  website: "https://reef.test",
  summary: "Small-group reef trips from Cairns.",
  heroImage: "https://reef.test/hero.jpg",
  contact: { email: "Bookings@Reef.test" },
  trips: [
    { title: "Outer reef day", kind: "snorkel", summary: "Two reef sites in a day.", sourceUrl: "https://reef.test/day", images: ["https://reef.test/turtle.jpg"], prices: [{ label: "Adult", amount: 189, currency: "AUD" }] },
    { title: "Sunset sail", kind: "sail", summary: "An evening on the water.", sourceUrl: "https://reef.test/sunset" },
  ],
};

async function linkFor(slug = page.slug, token = `tok-${Math.random().toString(36).slice(2)}`) {
  const sent = await requestOperatorClaimToken({ operatorSlug: slug, tokenFactory: () => token });
  expect(sent.ok).toBe(true);
  return token;
}

beforeEach(async () => {
  await resetRailsTables();
  await prisma.$executeRawUnsafe(`TRUNCATE "PreparedOperatorPage", "OperatorLead", "OperatorClaimToken", "OperatorClaim", "ReferralPartner" CASCADE`);
  await importPreparedOperator(page);
});

describe("claiming a prepared page from the emailed link", () => {
  it("shows the whole page, every photo included, before anything is claimed", async () => {
    const review = await reviewForClaim(await linkFor());
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.page.page.heroImage).toBe("https://reef.test/hero.jpg");
    expect(review.page.trips.map((t) => t.trip.title)).toEqual(["Outer reef day", "Sunset sail"]);
    expect(review.email).toBe("bookings@reef.test");
  });

  it("claims, approves the photos they saw and publishes the page, in one go", async () => {
    const result = await claimPreparedPage({ token: await linkFor() });
    expect(result).toMatchObject({ ok: true, slug: "reef-co" });

    const account = await prisma.bluePassAccount.findUnique({ where: { email: "bookings@reef.test" }, include: { operatorProfile: true } });
    expect(account?.emailVerifiedAt).toBeTruthy();
    expect(account?.operatorProfile).toMatchObject({ status: "APPROVED", claimedOperatorSlug: "reef-co" });
    expect((await prisma.operatorLead.findUnique({ where: { slug: "reef-co" } }))?.status).toBe("APPROVED");

    const live = await loadPreparedPage("reef-co");
    expect(live?.lead.claimed).toBe(true);
    expect(live?.trips).toHaveLength(2);
    expect(live?.page.heroImage).toBe("https://reef.test/hero.jpg");
    expect(live?.trips[0].trip.images).toEqual(["https://reef.test/turtle.jpg"]);
  });

  it("works once: the same link cannot claim again", async () => {
    const token = await linkFor();
    expect((await claimPreparedPage({ token })).ok).toBe(true);
    expect(await claimPreparedPage({ token })).toMatchObject({ ok: false });
  });

  it("refuses an expired link", async () => {
    const token = await linkFor();
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await claimPreparedPage({ token, now: later })).toMatchObject({ ok: false, message: expect.stringContaining("expired") });
  });

  it("will not move an account that already manages another page, and leaves the link usable", async () => {
    await importPreparedOperator({ ...page, slug: "other-co", name: "Other Co", contact: { email: "owner@other.test" } });
    expect((await claimPreparedPage({ token: await linkFor("other-co") })).ok).toBe(true);
    await prisma.operatorLead.update({ where: { slug: "reef-co" }, data: { email: "owner@other.test" } });

    const token = await linkFor();
    expect(await claimPreparedPage({ token })).toMatchObject({ ok: false, message: expect.stringContaining("already manages another page") });
    expect((await prisma.operatorClaimToken.findFirst({ where: { email: "owner@other.test", usedAt: null } }))).toBeTruthy();
  });
});
