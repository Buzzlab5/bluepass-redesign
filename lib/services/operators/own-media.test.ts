import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { requestOperatorClaimToken } from "@/lib/services/operators/operator-claim-tokens";
import { ownUrls, withOwnMedia, withoutOwn, type OwnMedia } from "@/lib/services/operators/own-media";
import { addOwnPhoto, addOwnVideo, removeOwn, setOwnHero, setOwnLogo } from "@/lib/services/operators/own-media-edits";
import { claimPreparedPage } from "@/lib/services/operators/prepared-claim";
import { claimedPreparedPage, importPreparedOperator, loadPreparedPage, type PreparedOperator } from "@/lib/services/operators/prepared-pages";
import { resetRailsTables } from "@/lib/services/rails/test-fixtures";

/**
 * An operator whose website will not let its photos be shown elsewhere, or that has no
 * logo file, fills their page themselves after claiming it. What they add is theirs to
 * publish: it shows at once, leads the page, and no re-import from the website undoes it.
 */

const page: PreparedOperator = {
  slug: "reef-co",
  name: "Reef Co",
  website: "https://reef.test",
  summary: "Small-group reef trips from Cairns.",
  heroImage: "https://reef.test/hero.jpg",
  logo: "https://reef.test/logo.png",
  gallery: ["https://reef.test/boat.jpg"],
  videos: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "From their site" }],
  contact: { email: "bookings@reef.test" },
  trips: [
    { title: "Outer reef day", kind: "snorkel", summary: "Two reef sites in a day.", sourceUrl: "https://reef.test/day", images: ["https://reef.test/turtle.jpg"] },
    { title: "Sunset sail", kind: "sail", summary: "An evening on the water.", sourceUrl: "https://reef.test/sunset" },
  ],
};

describe("laying the operator's own media over the page", () => {
  const trips = [{ id: "t1", trip: page.trips[0] }, { id: "t2", trip: page.trips[1] }];
  const own: OwnMedia = {
    logo: { url: "/u/logo.png", light: true },
    gallery: ["/u/a.jpg", "/u/b.jpg"],
    trips: { t2: ["/u/sail.jpg"] },
    videos: [{ url: "https://vimeo.com/123456789", title: "Theirs" }],
  };

  it("puts theirs first: logo, the top photo, the gallery, a trip's photos and videos", () => {
    const shown = withOwnMedia(page, trips, own);
    expect(shown.page).toMatchObject({ logo: "/u/logo.png", logoLight: true, heroImage: "/u/a.jpg" });
    expect(shown.page.gallery).toEqual(["/u/a.jpg", "/u/b.jpg", "https://reef.test/boat.jpg"]);
    expect(shown.page.videos?.map((v) => v.url)).toEqual(["https://vimeo.com/123456789", "https://youtu.be/dQw4w9WgXcQ"]);
    expect(shown.trips[0].trip.images).toEqual(["https://reef.test/turtle.jpg"]);
    expect(shown.trips[1].trip.images).toEqual(["/u/sail.jpg"]);
  });

  it("leads with the photo they chose, and lets go of what they remove", () => {
    expect(withOwnMedia(page, trips, { ...own, hero: "/u/sail.jpg" }).page.heroImage).toBe("/u/sail.jpg");
    const less = withoutOwn({ ...own, hero: "/u/a.jpg" }, "/u/a.jpg");
    expect(less.gallery).toEqual(["/u/b.jpg"]);
    expect(less.hero).toBeNull();
    expect(withoutOwn(own, "/u/sail.jpg").trips).toEqual({});
    expect([...ownUrls(own)]).toEqual(["/u/logo.png", "/u/a.jpg", "/u/b.jpg", "/u/sail.jpg"]);
  });
});

describe("the operator adding to their own page", () => {
  let accountId: string;

  beforeEach(async () => {
    await resetRailsTables();
    await prisma.$executeRawUnsafe(`TRUNCATE "PreparedOperatorPage", "OperatorLead", "OperatorClaimToken", "OperatorClaim", "ReferralPartner" CASCADE`);
    await importPreparedOperator(page);
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    await requestOperatorClaimToken({ operatorSlug: page.slug, tokenFactory: () => token });
    const claimed = await claimPreparedPage({ token });
    if (!claimed.ok) throw new Error(claimed.message);
    accountId = (await prisma.bluePassAccount.findUniqueOrThrow({ where: { email: "bookings@reef.test" } })).id;
  });

  it("shows what they add to travellers straight away, ahead of their website's", async () => {
    const before = await loadPreparedPage("reef-co");
    const sail = before!.trips.find((t) => t.trip.title === "Sunset sail")!;
    expect(await addOwnPhoto({ accountId, url: "/u/a.jpg", target: "page" })).toMatchObject({ ok: true });
    expect(await addOwnPhoto({ accountId, url: "/u/sail.jpg", target: sail.id })).toMatchObject({ ok: true, message: "Added to Sunset sail." });
    expect(await setOwnLogo({ accountId, url: "/u/logo.png", light: false })).toMatchObject({ ok: true });

    const live = await loadPreparedPage("reef-co");
    expect(live?.page.heroImage).toBe("/u/a.jpg");
    expect(live?.page.logo).toBe("/u/logo.png");
    expect(live?.trips.find((t) => t.id === sail.id)?.trip.images).toEqual(["/u/sail.jpg"]);
    // The chooser for website photos leaves their own alone.
    expect((await claimedPreparedPage(accountId))?.photos.map((p) => p.url)).not.toContain("/u/a.jpg");
  });

  it("leaves a claimed page alone when the website is read again: still live, still theirs", async () => {
    await addOwnPhoto({ accountId, url: "/u/a.jpg", target: "page" });
    expect(await importPreparedOperator({ ...page, summary: "Something the website says now." })).toMatchObject({ ok: true, claimed: true });
    const live = await loadPreparedPage("reef-co");
    expect(live?.page.summary).toBe("Small-group reef trips from Cairns.");
    expect(live?.page.gallery?.[0]).toBe("/u/a.jpg");
  });

  it("refuses a trip that is not on their page, a link that is not a video, and photos past the limit", async () => {
    expect(await addOwnPhoto({ accountId, url: "/u/x.jpg", target: "someone-elses-trip" })).toMatchObject({ ok: false, message: "That trip is not on your page." });
    expect(await addOwnVideo({ accountId, url: "https://www.facebook.com/reef/videos/1", title: "" })).toMatchObject({ ok: false });
    expect(await addOwnVideo({ accountId, url: "https://vimeo.com/123456789", title: "Reef day" })).toMatchObject({ ok: true });
    expect(await addOwnVideo({ accountId, url: "https://player.vimeo.com/video/123456789", title: "Again" })).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    for (let i = 0; i < 24; i += 1) await addOwnPhoto({ accountId, url: `/u/${i}.jpg`, target: "page" });
    expect(await addOwnPhoto({ accountId, url: "/u/25.jpg", target: "page" })).toMatchObject({ ok: false, message: expect.stringContaining("up to 24") });
  });

  it("lets them choose the top photo from their own, and take any of theirs off again", async () => {
    await addOwnPhoto({ accountId, url: "/u/a.jpg", target: "page" });
    await addOwnPhoto({ accountId, url: "/u/b.jpg", target: "page" });
    expect(await setOwnHero({ accountId, url: "https://reef.test/hero.jpg" })).toMatchObject({ ok: false });
    expect(await setOwnHero({ accountId, url: "/u/b.jpg" })).toMatchObject({ ok: true });
    expect((await loadPreparedPage("reef-co"))?.page.heroImage).toBe("/u/b.jpg");
    expect(await removeOwn({ accountId, url: "/u/b.jpg" })).toMatchObject({ ok: true });
    expect(await removeOwn({ accountId, url: "https://reef.test/boat.jpg" })).toMatchObject({ ok: false });
    expect((await loadPreparedPage("reef-co"))?.page.heroImage).toBe("/u/a.jpg");
  });

  it("lets no one add to a page before their claim is approved", async () => {
    await prisma.operatorProfile.updateMany({ where: { accountId }, data: { status: "PENDING_REVIEW" } });
    expect(await addOwnPhoto({ accountId, url: "/u/a.jpg", target: "page" })).toMatchObject({ ok: false, message: expect.stringContaining("claim is approved") });
  });
});
