import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { replaceRezdyApiForTests } from "@/lib/services/channels/rezdy/api";
import { createRezdySim, reefRunnerOnRezdy } from "@/lib/services/channels/rezdy/sim";
import { connectRezdy, disconnectRezdy, syncOperatorRezdy } from "@/lib/services/channels/rezdy/sync";
import { resetRailsTables } from "@/lib/services/rails/test-fixtures";

/**
 * Connecting an operator's Rezdy and keeping their trips in step with it, against the
 * Rezdy simulator: trips arrive on their own, change with Rezdy, stop selling when
 * they stop being shared, and nobody can attach someone else's Rezdy account.
 */

async function operator(companyName: string, email: string) {
  const account = await prisma.bluePassAccount.create({ data: { email, passwordHash: "x", roles: ["OPERATOR"] } });
  const profile = await prisma.operatorProfile.create({ data: { accountId: account.id, status: "APPROVED", companyName } });
  return { account, profile };
}

let sim: ReturnType<typeof createRezdySim>;

beforeEach(async () => {
  await resetRailsTables();
  sim = createRezdySim(reefRunnerOnRezdy("2026-11-01"));
  replaceRezdyApiForTests(sim.api);
});

afterEach(() => replaceRezdyApiForTests(undefined));

describe("connecting Rezdy", () => {
  it("brings in every shared trip, selling the ones Bluepass can sell and holding back the rest", async () => {
    const { profile, account } = await operator("Reef Runner Charters", "bookings@reefrunner.com.au");
    const result = await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "https://reefrunner.rezdy.com/" });
    expect(result).toMatchObject({ ok: true });

    const connection = await prisma.operatorChannelConnection.findUniqueOrThrow({ where: { operatorProfileId_platform: { operatorProfileId: profile.id, platform: "REZDY" } } });
    expect(connection).toMatchObject({ status: "CONNECTED", accountKey: "reefrunner", externalId: "77001", timezone: "Australia/Brisbane" });
    expect((await prisma.operatorProfile.findUniqueOrThrow({ where: { id: profile.id } })).rezdySupplierId).toBe("77001");

    const trips = await prisma.operatorListing.findMany({ where: { operatorProfileId: profile.id }, orderBy: { externalProductId: "asc" } });
    expect(trips.map((t) => [t.externalProductId, t.channel, t.status, t.channelIssue === null])).toEqual([
      ["PRR001", "REZDY", "LIVE", true],
      ["PRR002", "REZDY", "LIVE", true],
      ["PRR003", "REZDY", "LIVE", true],
      ["PRR004", "REZDY", "DRAFT", false],
    ]);
    const reef = trips[0];
    expect(reef).toMatchObject({
      title: "Outer Reef Snorkel and Dive",
      region: "Cairns, QLD",
      meetingPoint: "Marina Pier B, Cairns",
      durationMinutes: 480,
      priceFrom: 129,
      confirmationNote: "Check in at Marina Pier B 30 minutes before departure. Bring a hat, sunscreen and a towel.",
    });
    expect(reef.description).toContain("Lunch, reef tax");
    expect((reef.channelData as { pickups: unknown[] }).pickups).toHaveLength(2);
    expect(trips[3].channelIssue).toMatch(/deposit/);
  });

  it("refuses a Rezdy account that nothing ties to the operator", async () => {
    const { profile, account } = await operator("Coral Coast Tours", "coralcoast@gmail.com");
    const result = await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/belongs to Reef Runner Charters Pty Ltd/);
    expect(await prisma.operatorListing.count()).toBe(0);
  });

  it("accepts the match on the business's own email domain", async () => {
    const { profile, account } = await operator("RR Charters", "skipper@reefrunner.com.au");
    expect(await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" })).toMatchObject({ ok: true });
  });

  it("waits for trips to be shared, then picks them up on the next check", async () => {
    const shared = sim.api.marketplaceProducts;
    let sharing = false;
    sim.api.marketplaceProducts = async (q) => (sharing ? shared(q) : []);
    const { profile, account } = await operator("Reef Runner Charters", "bookings@reefrunner.com.au");

    expect(await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" })).toMatchObject({ ok: true });
    expect(await prisma.operatorChannelConnection.findFirstOrThrow()).toMatchObject({ status: "WAITING" });

    sharing = true;
    const check = await syncOperatorRezdy(profile.id);
    expect(check).toMatchObject({ ok: true });
    expect(await prisma.operatorChannelConnection.findFirstOrThrow()).toMatchObject({ status: "CONNECTED" });
    expect(await prisma.operatorListing.count({ where: { channel: "REZDY" } })).toBe(4);
  });

  it("stops selling a trip Rezdy no longer shares, and sells it again when it comes back", async () => {
    const { profile, account } = await operator("Reef Runner Charters", "bookings@reefrunner.com.au");
    await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" });
    const sunset = sim.api;
    const all = await sunset.marketplaceProducts({ supplierAlias: "reefrunner" });
    sim.supplier.withdraw("PRR002");
    await syncOperatorRezdy(profile.id);
    expect((await prisma.operatorListing.findFirstOrThrow({ where: { externalProductId: "PRR002" } })).channelIssue).toMatch(/No longer shared/);

    sim.api.marketplaceProducts = async () => all;
    await syncOperatorRezdy(profile.id);
    expect((await prisma.operatorListing.findFirstOrThrow({ where: { externalProductId: "PRR002" } })).channelIssue).toBeNull();
  });

  it("moves trips the Discover sync made before the operator signed up onto their own account", async () => {
    const placeholder = await prisma.bluePassAccount.create({ data: { email: "rezdy+77001@ops.bluepass.co", passwordHash: "x", roles: ["OPERATOR"] } });
    const held = await prisma.operatorProfile.create({ data: { accountId: placeholder.id, status: "LIVE", companyName: "Reef Runner Charters", rezdySupplierId: "77001" } });
    await prisma.operatorListing.create({
      data: { operatorProfileId: held.id, title: "Outer Reef Snorkel and Dive", slug: "outer-reef-placeholder", category: "Tour", region: "Cairns", description: "From the Discover sync.", status: "LIVE", channel: "REZDY", externalProductId: "PRR001" },
    });

    const { profile, account } = await operator("Reef Runner Charters", "bookings@reefrunner.com.au");
    expect(await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" })).toMatchObject({ ok: true });

    const moved = await prisma.operatorListing.findFirstOrThrow({ where: { externalProductId: "PRR001" } });
    expect(moved.operatorProfileId).toBe(profile.id);
    expect(moved.slug).toBe("outer-reef-placeholder");
    expect((await prisma.operatorProfile.findUniqueOrThrow({ where: { id: held.id } })).rezdySupplierId).toBeNull();
    expect(await prisma.operatorListing.count({ where: { externalProductId: "PRR001" } })).toBe(1);
  });

  it("never lets a second real operator take an account that is already connected", async () => {
    const first = await operator("Reef Runner Charters", "bookings@reefrunner.com.au");
    await connectRezdy({ operatorProfileId: first.profile.id, accountEmail: first.account.email, address: "reefrunner" });
    const second = await operator("Reef Runner Charters", "ops@reefrunner.com.au");
    const result = await connectRezdy({ operatorProfileId: second.profile.id, accountEmail: second.account.email, address: "reefrunner" });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/already connected/);
  });

  it("disconnecting stops every Rezdy trip selling and leaves bookings alone", async () => {
    const { profile, account } = await operator("Reef Runner Charters", "bookings@reefrunner.com.au");
    await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" });
    await disconnectRezdy(profile.id);
    expect(await prisma.operatorChannelConnection.count()).toBe(0);
    expect(await prisma.operatorListing.count({ where: { channel: "REZDY", channelIssue: null } })).toBe(0);
  });
});
