import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { countPendingApprovals, listPendingApprovals } from "@/lib/services/admin/review-queue";
import {
  approvePhotos,
  approveWaitingTrips,
  claimedPreparedPage,
  importPreparedOperator,
  loadPreparedPage,
  setPageCheck,
  setPageEdits,
  setTripCheck,
  setTripEdits,
  type PreparedOperator,
} from "@/lib/services/operators/prepared-pages";
import { fieldText, TRIP_FIELDS } from "@/lib/services/operators/prepared-edits";
import { resetRailsTables } from "@/lib/services/rails/test-fixtures";

/**
 * Prepared pages link the operator's own photos. These pin down who sees them: the person
 * checking the page sees all of them, a traveller sees only the ones the operator approved
 * after their claim was approved, and a photo added later waits to be asked about.
 */

const page: PreparedOperator = {
  slug: "reef-co",
  name: "Reef Co",
  website: "https://reef.test",
  summary: "Small-group reef trips from Cairns.",
  heroImage: "https://reef.test/hero.jpg",
  trips: [
    { title: "Outer reef day", kind: "snorkel", summary: "Two reef sites in a day.", sourceUrl: "https://reef.test/day", images: ["https://reef.test/turtle.jpg", "https://reef.test/boat.jpg"], priceFrom: 189 },
  ],
};

async function approvedForTravellers() {
  await importPreparedOperator(page);
  await setPageCheck({ slug: page.slug, status: "approved", notes: null, reviewer: "tony" });
  const loaded = await loadPreparedPage(page.slug, { preview: true });
  for (const t of loaded!.trips) await setTripCheck({ listingId: t.id, status: "approved", notes: null, reviewer: "tony" });
}

async function claimant(status: "APPROVED" | "PENDING_REVIEW") {
  const account = await prisma.bluePassAccount.create({ data: { email: `owner-${status}@reef.test`, passwordHash: "x", roles: ["OPERATOR"] } });
  await prisma.operatorProfile.create({ data: { accountId: account.id, status, companyName: "Reef Co", claimedOperatorSlug: page.slug } });
  return account.id;
}

beforeEach(async () => {
  await resetRailsTables();
  await prisma.$executeRawUnsafe(`TRUNCATE "PreparedOperatorPage", "OperatorLead" CASCADE`);
});

describe("photos on a prepared page", () => {
  it("shows a traveller none of them until the operator approves", async () => {
    await approvedForTravellers();
    const publicView = await loadPreparedPage(page.slug);
    expect(publicView!.page.heroImage).toBeNull();
    expect(publicView!.trips[0].trip.images).toEqual([]);

    const preview = await loadPreparedPage(page.slug, { preview: true });
    expect(preview!.trips[0].trip.images).toHaveLength(2);
  });

  it("will not take a choice from a claim that is still being checked", async () => {
    await approvedForTravellers();
    const accountId = await claimant("PENDING_REVIEW");
    const result = await approvePhotos({ accountId, keep: ["https://reef.test/turtle.jpg"] });
    expect(result.ok).toBe(false);
    expect((await loadPreparedPage(page.slug))!.trips[0].trip.images).toEqual([]);
  });

  it("shows travellers exactly what an approved operator kept, and nothing that is not on the page", async () => {
    await approvedForTravellers();
    const accountId = await claimant("APPROVED");
    const result = await approvePhotos({ accountId, keep: ["https://reef.test/turtle.jpg", "https://elsewhere.test/not-theirs.jpg"] });
    expect(result.ok).toBe(true);

    const publicView = await loadPreparedPage(page.slug);
    expect(publicView!.trips[0].trip.images).toEqual(["https://reef.test/turtle.jpg"]);
    expect(publicView!.page.heroImage).toBeNull();
    expect((await prisma.preparedOperatorPage.findUnique({ where: { slug: page.slug } }))!.photosApproved).toEqual(["https://reef.test/turtle.jpg"]);
  });

  it("asks about a photo added by a later import instead of showing it", async () => {
    await approvedForTravellers();
    const accountId = await claimant("APPROVED");
    await approvePhotos({ accountId, keep: ["https://reef.test/turtle.jpg"] });
    expect((await claimedPreparedPage(accountId))!.undecided).toBe(0);

    await importPreparedOperator({ ...page, trips: [{ ...page.trips[0], images: [...page.trips[0].images!, "https://reef.test/manta.jpg"] }] });
    const claimed = await claimedPreparedPage(accountId);
    expect(claimed!.undecided).toBe(1);
    expect(claimed!.photos.find((p) => p.url === "https://reef.test/manta.jpg")).toMatchObject({ isNew: true, approved: false });
    expect(claimed!.photos.find((p) => p.url === "https://reef.test/boat.jpg")).toMatchObject({ isNew: false, approved: false });
  });

  it("keeps a checked trip approved when only its photos change", async () => {
    await approvedForTravellers();
    await importPreparedOperator({ ...page, heroImage: null, trips: [{ ...page.trips[0], images: ["https://reef.test/turtle.jpg"] }] });
    const after = await loadPreparedPage(page.slug, { preview: true });
    expect(after!.page.qcStatus).toBe("approved");
    expect(after!.trips[0].check.status).toBe("approved");

    await importPreparedOperator({ ...page, trips: [{ ...page.trips[0], prices: [{ label: "Adult", amount: 199, currency: "AUD" }] }] });
    expect((await loadPreparedPage(page.slug, { preview: true }))!.trips[0].check.status).toBe("pending");
  });

  it("does not put the placeholder that holds an unclaimed page in the approvals queue", async () => {
    await importPreparedOperator(page);
    await prisma.$executeRawUnsafe(`TRUNCATE "OperatorClaim", "PartnerProfile" CASCADE`);
    expect(await countPendingApprovals()).toBe(0);
    await claimant("PENDING_REVIEW");
    expect(await countPendingApprovals()).toBe(1);
    expect((await listPendingApprovals()).applications.map((a) => a.title)).toEqual(["Reef Co"]);
  });

  it("is not offered to the placeholder account that holds the page before a claim", async () => {
    await importPreparedOperator(page);
    const placeholder = await prisma.bluePassAccount.findUnique({ where: { email: "prebuilt+reef-co@ops.bluepass.co" } });
    expect(await claimedPreparedPage(placeholder!.id)).toBeNull();
  });
});

describe("checking a page", () => {
  it("approves the waiting trips in one go, leaving the ones needing a fix or out of date", async () => {
    await importPreparedOperator({
      ...page,
      trips: [
        page.trips[0],
        { title: "Whale week", kind: "swim", summary: "A week of whale swims.", sourceUrl: "https://reef.test/week", season: "Aug 24th-30th (2020)" },
        { title: "Night dive", kind: "dive", summary: "A dive after dark.", sourceUrl: "https://reef.test/night" },
      ],
    });
    const before = await loadPreparedPage(page.slug, { preview: true });
    const night = before!.trips.find((t) => t.trip.title === "Night dive")!;
    await setTripCheck({ listingId: night.id, status: "needs_fix", notes: "Price missing", reviewer: "tony" });

    const result = await approveWaitingTrips({ slug: page.slug, reviewer: "tony" });
    expect(result.message).toBe("Approved 1 trip. 1 that looks out of date is still waiting.");
    const after = await loadPreparedPage(page.slug, { preview: true });
    expect(Object.fromEntries(after!.trips.map((t) => [t.trip.title, t.check.status]))).toEqual({
      "Outer reef day": "approved", "Whale week": "pending", "Night dive": "needs_fix",
    });
  });
});

describe("correcting a page", () => {
  const formFor = (trip: Record<string, unknown>) => Object.fromEntries(TRIP_FIELDS.map((f) => [f.name, f.name === "priceFrom" ? "" : fieldText(f.kind, trip[f.name])]));

  it("keeps a correction through a re-import, and a renamed trip stays one trip", async () => {
    await importPreparedOperator(page);
    const [trip] = (await loadPreparedPage(page.slug, { preview: true }))!.trips;
    const saved = await setTripEdits({
      listingId: trip.id, editor: "tony",
      form: { ...formFor(trip.trip as unknown as Record<string, unknown>), title: "Outer Reef Day Trip", prices: "Adult = 199" },
    });
    expect(saved).toMatchObject({ ok: true, message: expect.stringContaining("Saved 2 corrections") });

    const result = await importPreparedOperator(page);
    expect(result).toMatchObject({ created: 0, unchanged: 1, removed: 0 });
    const [after] = (await loadPreparedPage(page.slug, { preview: true }))!.trips;
    expect([after.trip.title, after.trip.priceFrom, after.website.title]).toEqual(["Outer Reef Day Trip", 199, "Outer reef day"]);
    const listing = await prisma.operatorListing.findUnique({ where: { id: after.id } });
    expect([listing!.title, listing!.priceFrom?.toString()]).toEqual(["Outer Reef Day Trip", "199"]);
  });

  it("drops a correction once it matches the website again", async () => {
    await importPreparedOperator(page);
    const [trip] = (await loadPreparedPage(page.slug, { preview: true }))!.trips;
    await setTripEdits({ listingId: trip.id, editor: "tony", form: { ...formFor(trip.trip as unknown as Record<string, unknown>), season: "Year round" } });
    const back = await setTripEdits({ listingId: trip.id, editor: "tony", form: formFor(trip.website as unknown as Record<string, unknown>) });
    expect(back.message).toBe("Saved. The trip matches the website again.");
    expect((await loadPreparedPage(page.slug, { preview: true }))!.trips[0].edits).toBeNull();
  });

  it("corrects the operator's phone number and keeps it through a re-import", async () => {
    await importPreparedOperator({ ...page, contact: { phone: "+61 4747 7777" } });
    await setPageEdits({ slug: page.slug, editor: "tony", form: { summary: page.summary, standouts: "", phone: "+61 4 74 727 777", email: "", address: "" } });
    await importPreparedOperator({ ...page, contact: { phone: "+61 4747 7777" } });
    const loaded = await loadPreparedPage(page.slug, { preview: true });
    expect([loaded!.page.contact?.phone, loaded!.website.contact?.phone]).toEqual(["+61 4 74 727 777", "+61 4747 7777"]);
  });
});
