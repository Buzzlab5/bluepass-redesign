import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  addFareHarborTrip,
  connectFareHarbor,
  linkFareHarborTrip,
  recordHandoff,
} from "@/lib/services/channels/fareharbor/connect";
import { fareHarborBookingUrl, fareHarborLightframe, parseFareHarborLink } from "@/lib/services/channels/fareharbor/links";
import { resetRailsTables, seedOperator } from "@/lib/services/rails/test-fixtures";

/**
 * FareHarbor through the affiliate link: the only thing FareHarbor offers an affiliate
 * below its API threshold. What matters is that every link Bluepass sends a traveller
 * down carries Bluepass's affiliate tag and a reference of its own, and that an
 * operator cannot attach a trip whose link would not pay Bluepass.
 */

const TAGGED = "https://fareharbor.com/embeds/book/reefrunner/items/412233/?full-items=yes&flow=no&asn=bluepass&ref=bluepass";

beforeAll(() => { process.env.FAREHARBOR_AFFILIATE_SHORTNAME = "bluepass"; });
afterAll(() => { delete process.env.FAREHARBOR_AFFILIATE_SHORTNAME; });
beforeEach(async () => { await resetRailsTables(); });

describe("links", () => {
  it("reads every shape of FareHarbor link an operator pastes", () => {
    expect(parseFareHarborLink(TAGGED)).toEqual({ shortname: "reefrunner", itemId: "412233", flow: null, availabilityId: null, asn: "bluepass", ref: "bluepass" });
    expect(parseFareHarborLink("fareharbor.com/reefrunner/items/412233/calendar/")).toMatchObject({ shortname: "reefrunner", itemId: "412233" });
    expect(parseFareHarborLink("https://fareharbor.com/embeds/book/reefrunner/?full-items=yes&flow=576772")).toMatchObject({ itemId: null, flow: "576772" });
    expect(parseFareHarborLink("https://fareharbor.com/reefrunner/items/412233/availability/998877/book/")).toMatchObject({ availabilityId: "998877" });
    expect(parseFareHarborLink("reefrunner")).toMatchObject({ shortname: "reefrunner", itemId: null });
    expect(parseFareHarborLink("https://reefrunner.com.au/book")).toBeNull();
  });

  it("builds the checkout with Bluepass's affiliate tag and the hand-off reference", () => {
    const link = parseFareHarborLink(TAGGED)!;
    const url = new URL(fareHarborBookingUrl(link, { asn: "bluepass", asnRef: "BP-7K3QXD" }));
    expect(url.pathname).toBe("/embeds/book/reefrunner/items/412233/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ "full-items": "yes", asn: "bluepass", "asn-ref": "BP-7K3QXD", ref: "bluepass" });
    expect(fareHarborLightframe(link, { asn: "bluepass", asnRef: "BP-7K3QXD" })).toMatchObject({
      shortname: "reefrunner", view: { item: 412233 }, asn: "bluepass", asnRef: "BP-7K3QXD", ref: "bluepass", fullItems: "yes",
    });
  });
});

describe("connecting and adding trips", () => {
  it("waits on a link without Bluepass's tag, connects on one with it", async () => {
    const { profile } = await seedOperator();
    await connectFareHarbor({ operatorProfileId: profile.id, link: "https://fareharbor.com/embeds/book/reefrunner/items/412233/" });
    expect(await prisma.operatorChannelConnection.findFirstOrThrow()).toMatchObject({ platform: "FAREHARBOR", status: "WAITING", accountKey: "reefrunner" });
    await connectFareHarbor({ operatorProfileId: profile.id, link: TAGGED });
    expect(await prisma.operatorChannelConnection.findFirstOrThrow()).toMatchObject({ status: "CONNECTED" });
  });

  it("adds a trip that books on FareHarbor, live at once", async () => {
    const { profile } = await seedOperator();
    const result = await addFareHarborTrip({
      operatorProfileId: profile.id,
      link: TAGGED,
      title: "Turtle Snorkel",
      region: "Bridgetown, Barbados",
      description: "Swim with green turtles over the wrecks of Carlisle Bay.",
      heroImageUrl: "images.unsplash.com/photo-1",
      priceFrom: "89",
      currency: "usd",
      durationMinutes: 120,
    });
    expect(result).toMatchObject({ ok: true });
    const trip = await prisma.operatorListing.findUniqueOrThrow({ where: { id: result.listingId! } });
    expect(trip).toMatchObject({ channel: "FAREHARBOR", externalProductId: "412233", status: "LIVE", currency: "USD", priceFrom: 89, heroImageUrl: "https://images.unsplash.com/photo-1", channelIssue: null });
    expect(trip.externalBookingUrl).toContain("asn=bluepass");
    expect(await addFareHarborTrip({ operatorProfileId: profile.id, link: TAGGED, title: "Again", region: "Bridgetown", description: "The same trip again, twice." })).toMatchObject({ ok: false });
  });

  it("refuses a trip link that would not pay Bluepass, or belongs to someone else", async () => {
    const { profile } = await seedOperator();
    await connectFareHarbor({ operatorProfileId: profile.id, link: TAGGED });
    const untagged = await addFareHarborTrip({ operatorProfileId: profile.id, link: "https://fareharbor.com/embeds/book/reefrunner/items/5/?asn=someoneelse", title: "X trip", region: "Somewhere", description: "Long enough description." });
    expect(untagged.message).toMatch(/affiliate tag/);
    const theirs = await addFareHarborTrip({ operatorProfileId: profile.id, link: "https://fareharbor.com/embeds/book/othercompany/items/5/?asn=bluepass", title: "X trip", region: "Somewhere", description: "Long enough description." });
    expect(theirs.message).toMatch(/belongs to the FareHarbor account "othercompany"/);
  });

  it("switches an existing trip to FareHarbor, and its own schedule stops selling", async () => {
    const { profile, listing } = await seedOperator();
    expect(await linkFareHarborTrip({ operatorProfileId: profile.id, listingId: listing.id, link: TAGGED })).toMatchObject({ ok: true });
    expect(await prisma.operatorListing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({ channel: "FAREHARBOR", externalProductId: "412233" });
    expect(await prisma.listingSchedule.count({ where: { listingId: listing.id, active: true } })).toBe(0);
  });

  it("records each hand-off with a reference that rides along as FareHarbor's voucher number", async () => {
    const { profile } = await seedOperator();
    const added = await addFareHarborTrip({ operatorProfileId: profile.id, link: TAGGED, title: "Turtle Snorkel", region: "Bridgetown", description: "Swim with green turtles." });
    const listing = await prisma.operatorListing.findUniqueOrThrow({ where: { id: added.listingId! } });
    const handoff = await recordHandoff(listing, "CREATOR42");
    expect(handoff!.reference).toMatch(/^BP-[A-Z0-9]{6}$/);
    expect(new URL(handoff!.url).searchParams.get("asn-ref")).toBe(handoff!.reference);
    expect(await prisma.channelHandoff.findUniqueOrThrow({ where: { reference: handoff!.reference } })).toMatchObject({ channel: "FAREHARBOR", referralCode: "CREATOR42", listingId: listing.id });
  });
});
