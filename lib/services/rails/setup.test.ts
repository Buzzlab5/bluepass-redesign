import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createOperatorBooking } from "@/lib/services/rails/bookings";
import { addBlackout, removeRate, removeSchedule, saveRate, saveSchedule, type ScheduleInput } from "@/lib/services/rails/setup";
import { resetRailsTables, seedOperator, THURSDAY_8AM } from "@/lib/services/rails/test-fixtures";

const NOW = new Date("2026-07-01T00:00:00Z");

beforeEach(async () => {
  await resetRailsTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function rule(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    weekdays: [2, 4, 6], departureTimes: ["08:00"], capacityPerDeparture: 12, minGuests: 1,
    cutoffHours: 24, maxAdvanceDays: 365, timezone: "Australia/Brisbane", seasonStart: null, seasonEnd: null, ...over,
  };
}

async function withThursdayBooking(guests = 4) {
  const seeded = await seedOperator();
  const r = await createOperatorBooking({
    operatorProfileId: seeded.profile.id, listingId: seeded.listing.id, departsAt: THURSDAY_8AM,
    quantities: { [seeded.adult.id]: guests }, lead: { name: "Booked Guest" }, paid: true, sendConfirmation: false, actorEmail: "op", now: NOW,
  });
  if (!r.ok) throw new Error(r.reason);
  return seeded;
}

describe("schedule edits never strand a sold seat", () => {
  it("refuses to drop a weekday that has bookings on it, and names the departure", async () => {
    const { profile, listing, schedule } = await withThursdayBooking();
    const r = await saveSchedule({ operatorProfileId: profile.id, listingId: listing.id, scheduleId: schedule.id, values: rule({ weekdays: [2, 6] }), now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/16 July, 8:00am \(4 booked\)/);
  });

  it("refuses to move the departure time out from under a booking", async () => {
    const { profile, listing, schedule } = await withThursdayBooking();
    const r = await saveSchedule({ operatorProfileId: profile.id, listingId: listing.id, scheduleId: schedule.id, values: rule({ departureTimes: ["09:00"] }), now: NOW });
    expect(r.ok).toBe(false);
  });

  it("refuses to shrink the boat below what one departure has sold", async () => {
    const { profile, listing, schedule } = await withThursdayBooking(6);
    expect((await saveSchedule({ operatorProfileId: profile.id, listingId: listing.id, scheduleId: schedule.id, values: rule({ capacityPerDeparture: 5 }), now: NOW })).ok).toBe(false);
    expect((await saveSchedule({ operatorProfileId: profile.id, listingId: listing.id, scheduleId: schedule.id, values: rule({ capacityPerDeparture: 6 }), now: NOW })).ok).toBe(true);
  });

  it("allows any change that keeps every booked departure", async () => {
    const { profile, listing, schedule } = await withThursdayBooking();
    const r = await saveSchedule({ operatorProfileId: profile.id, listingId: listing.id, scheduleId: schedule.id, values: rule({ weekdays: [1, 2, 4, 6], departureTimes: ["08:00", "13:00"] }), now: NOW });
    expect(r.ok).toBe(true);
  });

  it("will not remove a pattern with future bookings, and deactivates rather than deletes one without", async () => {
    const { profile, listing, schedule } = await withThursdayBooking();
    expect((await removeSchedule({ operatorProfileId: profile.id, listingId: listing.id, scheduleId: schedule.id, now: NOW })).ok).toBe(false);
    const later = new Date("2026-08-01T00:00:00Z");
    expect((await removeSchedule({ operatorProfileId: profile.id, listingId: listing.id, scheduleId: schedule.id, now: later })).ok).toBe(true);
    expect(await prisma.listingSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).toMatchObject({ active: false });
  });

  it("refuses to close dates that guests are booked on", async () => {
    const { profile, listing } = await withThursdayBooking();
    const blocked = await addBlackout({ operatorProfileId: profile.id, listingId: listing.id, startDate: "2026-07-14", endDate: "2026-07-18", reason: "Slipway" });
    expect(blocked.ok).toBe(false);
    const clear = await addBlackout({ operatorProfileId: profile.id, listingId: listing.id, startDate: "2026-07-20", endDate: "2026-07-25", reason: "Slipway" });
    expect(clear.ok).toBe(true);
  });

  it("will not let one operator edit another's schedule", async () => {
    const { listing, schedule } = await withThursdayBooking();
    const other = await seedOperator();
    const r = await saveSchedule({ operatorProfileId: other.profile.id, listingId: listing.id, scheduleId: schedule.id, values: rule(), now: NOW });
    expect(r).toMatchObject({ ok: false, message: "That trip is not one of yours." });
  });
});

describe("prices", () => {
  it("keeps exactly one default and keeps the Discover price at the cheapest per-guest rate", async () => {
    const { profile, listing, adult } = await seedOperator();
    await saveRate({
      operatorProfileId: profile.id, listingId: listing.id,
      values: { label: "Senior", amount: 149, perGuest: true, minAge: 65, maxAge: null, seasonStart: null, seasonEnd: null, isDefault: true },
    });
    const defaults = await prisma.listingRate.findMany({ where: { listingId: listing.id, isDefault: true } });
    expect(defaults.map((r) => r.label)).toEqual(["Senior"]);
    // Child is A$99 in the fixture, the cheapest per-guest price.
    expect((await prisma.operatorListing.findUniqueOrThrow({ where: { id: listing.id } })).priceFrom).toBe(99);

    // Removing the default hands the role on rather than leaving none.
    await removeRate({ operatorProfileId: profile.id, listingId: listing.id, rateId: defaults[0].id });
    expect(await prisma.listingRate.count({ where: { listingId: listing.id, isDefault: true, active: true } })).toBe(1);
    void adult;
  });

  it("stores cents exactly, so 189.95 never becomes 18994", async () => {
    const { profile, listing } = await seedOperator();
    await saveRate({
      operatorProfileId: profile.id, listingId: listing.id,
      values: { label: "Sunset", amount: 189.95, perGuest: true, minAge: null, maxAge: null, seasonStart: null, seasonEnd: null, isDefault: false },
    });
    expect((await prisma.listingRate.findFirstOrThrow({ where: { label: "Sunset" } })).amountCents).toBe(18995);
  });
});
