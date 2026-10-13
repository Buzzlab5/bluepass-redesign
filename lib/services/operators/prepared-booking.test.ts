import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { replaceRezdyApiForTests } from "@/lib/services/channels/rezdy/api";
import { createRezdySim, reefRunnerOnRezdy } from "@/lib/services/channels/rezdy/sim";
import { connectRezdy, syncOperatorRezdy } from "@/lib/services/channels/rezdy/sync";
import { choosePreparedBooking, nameMatch, pairByName, preparedBookingFor } from "@/lib/services/operators/prepared-booking";
import { importPreparedOperator, loadPreparedPage, setPageCheck, setTripCheck } from "@/lib/services/operators/prepared-pages";
import { resetRailsTables } from "@/lib/services/rails/test-fixtures";

describe("matching trips by name", () => {
  it("pairs the names that clearly agree, each Rezdy trip once", () => {
    const pairs = pairByName(
      [{ id: "a", names: ["Outer Reef Snorkel & Dive Day"] }, { id: "b", names: ["Sunset Sail on Trinity Inlet"] }, { id: "c", names: ["Glass Bottom Boat"] }],
      [{ id: "1", name: "Outer Reef Snorkel and Dive" }, { id: "2", name: "Sunset Sail Trinity Inlet" }, { id: "3", name: "Private Reef Charter" }],
    );
    expect(Object.fromEntries(pairs)).toEqual({ a: "1", b: "2" });
  });

  it("leaves names that could be either of two Rezdy trips for the operator", () => {
    // Rodney Fox runs several expeditions whose names differ only in their length
    const pairs = pairByName(
      [{ id: "a", names: ["Great White Shark Expedition"] }],
      [{ id: "1", name: "Great White Shark Expedition 4 Day" }, { id: "2", name: "Great White Shark Expedition 6 Day" }],
    );
    expect(pairs.size).toBe(0);
    expect(nameMatch("Great White Shark Expedition (4 days/4 Nights)", "Great White Shark Expedition 4 Day 4 Night")).toBe(1);
  });
});

describe("a claimed page that connects Rezdy", () => {
  let sim: ReturnType<typeof createRezdySim>;
  beforeEach(async () => {
    await resetRailsTables();
    await prisma.$executeRawUnsafe(`TRUNCATE "PreparedOperatorPage", "OperatorLead", "OperatorChannelConnection" CASCADE`);
    sim = createRezdySim(reefRunnerOnRezdy("2026-11-01"));
    replaceRezdyApiForTests(sim.api);
  });
  afterEach(() => replaceRezdyApiForTests(undefined));

  async function preparedAndClaimed() {
    await importPreparedOperator({
      slug: "reef-runner-charters", name: "Reef Runner Charters", website: "https://reefrunner.com.au", summary: "Reef trips from Cairns.",
      trips: [
        { title: "Outer Reef Snorkel & Dive Day", kind: "snorkel", summary: "Two reef sites.", sourceUrl: "https://reefrunner.com.au/day" },
        { title: "Sunset Sail on Trinity Inlet", kind: "sail", summary: "An evening sail.", sourceUrl: "https://reefrunner.com.au/sunset" },
        { title: "Glass Bottom Boat", kind: "cruise", summary: "Coral without getting wet.", sourceUrl: "https://reefrunner.com.au/glass" },
      ],
    });
    await setPageCheck({ slug: "reef-runner-charters", status: "approved", notes: null, reviewer: "tony" });
    for (const t of (await loadPreparedPage("reef-runner-charters", { preview: true }))!.trips) {
      await setTripCheck({ listingId: t.id, status: "approved", notes: null, reviewer: "tony" });
    }
    const account = await prisma.bluePassAccount.create({ data: { email: "bookings@reefrunner.com.au", passwordHash: "x", roles: ["OPERATOR"] } });
    const profile = await prisma.operatorProfile.create({
      data: { accountId: account.id, status: "APPROVED", companyName: "Reef Runner Charters", claimedOperatorSlug: "reef-runner-charters" },
    });
    return { account, profile };
  }

  it("matches its trips to the Rezdy trips by name, and travellers can book them", async () => {
    const { account, profile } = await preparedAndClaimed();
    expect(await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" })).toMatchObject({ ok: true });

    const page = await loadPreparedPage("reef-runner-charters");
    const bookable = Object.fromEntries(page!.trips.map((t) => [t.trip.title, t.bookable?.title ?? null]));
    expect(bookable).toEqual({
      "Outer Reef Snorkel & Dive Day": "Outer Reef Snorkel and Dive",
      "Sunset Sail on Trinity Inlet": "Sunset Sail Trinity Inlet",
      "Glass Bottom Boat": null,
    });
    const mine = await preparedBookingFor(account.id);
    expect(mine!.trips.filter((t) => t.listingId).map((t) => t.by)).toEqual(["name", "name"]);
  });

  it("keeps the operator's own match through the next sync", async () => {
    const { account, profile } = await preparedAndClaimed();
    await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" });
    const mine = await preparedBookingFor(account.id);
    const glass = mine!.trips.find((t) => t.title === "Glass Bottom Boat")!;
    const sunset = mine!.trips.find((t) => t.title === "Sunset Sail on Trinity Inlet")!;
    const charter = mine!.products.find((p) => p.title === "Private Reef Charter")!;

    expect(await choosePreparedBooking({ accountId: account.id, choices: { [glass.id]: charter.id, [sunset.id]: "none" } })).toMatchObject({ ok: true });
    await syncOperatorRezdy(profile.id);

    const after = Object.fromEntries((await loadPreparedPage("reef-runner-charters"))!.trips.map((t) => [t.trip.title, t.bookable?.title ?? null]));
    expect(after).toEqual({
      "Outer Reef Snorkel & Dive Day": "Outer Reef Snorkel and Dive",
      "Sunset Sail on Trinity Inlet": null,
      "Glass Bottom Boat": "Private Reef Charter",
    });
  });

  it("refuses one Rezdy trip for two trips, and a Rezdy trip from another account", async () => {
    const { account, profile } = await preparedAndClaimed();
    await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" });
    const mine = await preparedBookingFor(account.id);
    const [a, b] = mine!.trips;
    const p = mine!.products[0];
    expect(await choosePreparedBooking({ accountId: account.id, choices: { [a.id]: p.id, [b.id]: p.id } })).toMatchObject({ ok: false });
    expect(await choosePreparedBooking({ accountId: account.id, choices: { [a.id]: "someone-elses-listing" } })).toMatchObject({ ok: false });
  });

  it("does nothing for an operator whose claim is still being checked", async () => {
    const { account, profile } = await preparedAndClaimed();
    await prisma.operatorProfile.update({ where: { id: profile.id }, data: { status: "PENDING_REVIEW" } });
    await connectRezdy({ operatorProfileId: profile.id, accountEmail: account.email, address: "reefrunner" });
    expect((await loadPreparedPage("reef-runner-charters"))!.trips.every((t) => !t.bookable)).toBe(true);
  });
});
