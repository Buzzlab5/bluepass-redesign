import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  scheduleFindMany: vi.fn(),
  blackoutFindMany: vi.fn(),
  rateFindMany: vi.fn(),
  holdFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    listingSchedule: { findMany: h.scheduleFindMany },
    listingBlackout: { findMany: h.blackoutFindMany },
    listingRate: { findMany: h.rateFindMany },
    listingSeatHold: { findMany: h.holdFindMany },
  },
}));

import {
  quoteFor,
  resolveAvailability,
  seatsTaken,
  weekdayInZone,
  zonedTimeToUtc,
} from "./listing-availability";

const BRISBANE = "Australia/Brisbane"; // no daylight saving
const SYDNEY = "Australia/Sydney"; // observes daylight saving

/** Tue, Thu, Sat at 08:00, twelve seats, 24h cutoff. The shape of a reef day boat. */
function schedule(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sch1",
    listingId: "L1",
    weekdays: [2, 4, 6],
    departureTimes: ["08:00"],
    seasonStart: null,
    seasonEnd: null,
    capacityPerDeparture: 12,
    minGuests: 1,
    cutoffHours: 24,
    maxAdvanceDays: 365,
    timezone: BRISBANE,
    active: true,
    ...over,
  };
}

beforeEach(() => {
  h.scheduleFindMany.mockReset().mockResolvedValue([schedule()]);
  h.blackoutFindMany.mockReset().mockResolvedValue([]);
  h.rateFindMany.mockReset().mockResolvedValue([]);
  h.holdFindMany.mockReset().mockResolvedValue([]);
});

describe("zonedTimeToUtc", () => {
  it("converts a Brisbane morning to the right instant", () => {
    // Brisbane is UTC+10 all year.
    expect(zonedTimeToUtc("2026-07-15", "08:00", BRISBANE).toISOString())
      .toBe("2026-07-14T22:00:00.000Z");
  });

  it("uses standard time for a Sydney winter date", () => {
    // AEST, UTC+10.
    expect(zonedTimeToUtc("2026-07-15", "08:00", SYDNEY).toISOString())
      .toBe("2026-07-14T22:00:00.000Z");
  });

  it("uses daylight time for a Sydney summer date", () => {
    // AEDT, UTC+11. Getting this wrong shifts every summer cutoff by an hour.
    expect(zonedTimeToUtc("2026-01-15", "08:00", SYDNEY).toISOString())
      .toBe("2026-01-14T21:00:00.000Z");
  });

  it("handles midnight without rolling to the wrong day", () => {
    expect(zonedTimeToUtc("2026-07-15", "00:00", BRISBANE).toISOString())
      .toBe("2026-07-14T14:00:00.000Z");
  });
});

describe("weekdayInZone", () => {
  it("reads the local weekday, not the UTC one", () => {
    // 2026-07-15 is a Wednesday.
    expect(weekdayInZone("2026-07-15", BRISBANE)).toBe(3);
  });

  it("is correct on a date where UTC is still the previous day", () => {
    // Monday in Brisbane is still Sunday in UTC at 08:00 local.
    expect(weekdayInZone("2026-07-13", BRISBANE)).toBe(1);
  });
});

describe("resolveAvailability", () => {
  const now = new Date("2026-07-01T00:00:00Z");

  it("offers the departure when the day, season and capacity all allow it", async () => {
    // 2026-07-16 is a Thursday, which is in the pattern.
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.departures).toHaveLength(1);
    expect(r.departures[0].localTime).toBe("08:00");
    expect(r.departures[0].seatsLeft).toBe(12);
  });

  it("refuses a day the trip does not run, and names the days it does", async () => {
    // 2026-07-15 is a Wednesday.
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-15", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("Tuesday");
    expect(r.reason).toContain("Thursday");
    expect(r.reason).toContain("Saturday");
  });

  it("nets confirmed seats off capacity", async () => {
    h.holdFindMany.mockResolvedValue([{ seats: 10, confirmed: true, expiresAt: null }]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.departures[0].seatsLeft).toBe(2);
  });

  it("refuses when the party will not fit in what is left", async () => {
    h.holdFindMany.mockResolvedValue([{ seats: 11, confirmed: true, expiresAt: null }]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 4, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("full");
  });

  it("counts an unexpired hold against capacity", async () => {
    h.holdFindMany.mockResolvedValue([
      { seats: 12, confirmed: false, expiresAt: new Date("2026-07-01T01:00:00Z") },
    ]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 1, now });
    expect(r.available).toBe(false);
  });

  it("releases an expired hold rather than holding the seat forever", async () => {
    // An abandoned checkout must not take a seat off the boat permanently.
    h.holdFindMany.mockResolvedValue([
      { seats: 12, confirmed: false, expiresAt: new Date("2026-06-30T23:00:00Z") },
    ]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 1, now });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.departures[0].seatsLeft).toBe(12);
  });

  it("refuses inside the cutoff window and says how long the cutoff is", async () => {
    // Asking at 06:00 local on the morning of an 08:00 departure.
    const late = new Date("2026-07-15T20:00:00Z");
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now: late });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("24 hours");
  });

  it("allows a booking just outside the cutoff", async () => {
    // Departure is 2026-07-15T22:00Z; 25 hours before is 2026-07-14T21:00Z.
    const r = await resolveAvailability({
      listingId: "L1", date: "2026-07-16", guests: 2, now: new Date("2026-07-14T21:00:00Z"),
    });
    expect(r.available).toBe(true);
  });

  it("refuses a date outside the season and says so", async () => {
    h.scheduleFindMany.mockResolvedValue([schedule({
      seasonStart: new Date("2026-09-01T00:00:00Z"),
      seasonEnd: new Date("2026-11-30T00:00:00Z"),
    })]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("season");
  });

  it("refuses a blackout date and says when it is back", async () => {
    h.blackoutFindMany.mockResolvedValue([{
      reason: "annual maintenance",
      endDate: new Date("2026-07-20T00:00:00Z"),
    }]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("annual maintenance");
    expect(r.reason).toContain("2026-07-21");
  });

  it("refuses a party below the minimum the trip needs to run", async () => {
    h.scheduleFindMany.mockResolvedValue([schedule({ minGuests: 4 })]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("at least 4");
  });

  it("says plainly when an operator has loaded no schedule at all", async () => {
    h.scheduleFindMany.mockResolvedValue([]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("not have bookable dates");
  });

  it("returns every departure time on the day, earliest first", async () => {
    h.scheduleFindMany.mockResolvedValue([schedule({ departureTimes: ["13:00", "08:00"] })]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.departures.map((d) => d.localTime)).toEqual(["08:00", "13:00"]);
  });

  it("treats an empty weekday list as running every day", async () => {
    h.scheduleFindMany.mockResolvedValue([schedule({ weekdays: [] })]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-15", guests: 2, now });
    expect(r.available).toBe(true);
  });

  it("refuses a date beyond how far ahead bookings are open", async () => {
    h.scheduleFindMany.mockResolvedValue([schedule({ maxAdvanceDays: 30, weekdays: [] })]);
    const r = await resolveAvailability({ listingId: "L1", date: "2027-07-16", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("further ahead");
  });
});

describe("quoteFor", () => {
  const onDate = new Date("2026-07-16T00:00:00Z");

  it("multiplies a per-guest rate by the party size", async () => {
    h.rateFindMany.mockResolvedValue([{
      label: "Adult", amountCents: 18900, currency: "AUD", perGuest: true,
      isDefault: true, seasonStart: null, seasonEnd: null,
    }]);
    const q = await quoteFor("L1", 3, onDate);
    expect(q?.totalCents).toBe(56700);
    expect(q?.lines[0]).toMatchObject({ label: "Adult", quantity: 3 });
  });

  it("charges a flat rate once regardless of party size", async () => {
    h.rateFindMany.mockResolvedValue([{
      label: "Private charter", amountCents: 120000, currency: "AUD", perGuest: false,
      isDefault: true, seasonStart: null, seasonEnd: null,
    }]);
    const q = await quoteFor("L1", 6, onDate);
    expect(q?.totalCents).toBe(120000);
    expect(q?.lines[0].quantity).toBe(1);
  });

  it("returns nothing rather than inventing a price when no rate applies", async () => {
    // A quote from an absent rate is a price the operator never agreed to.
    h.rateFindMany.mockResolvedValue([]);
    expect(await quoteFor("L1", 2, onDate)).toBeNull();
  });

  it("ignores a rate whose season does not cover the date", async () => {
    h.rateFindMany.mockResolvedValue([{
      label: "Peak", amountCents: 25000, currency: "AUD", perGuest: true, isDefault: true,
      seasonStart: new Date("2026-12-01T00:00:00Z"), seasonEnd: new Date("2027-01-31T00:00:00Z"),
    }]);
    expect(await quoteFor("L1", 2, onDate)).toBeNull();
  });

  it("prefers the default rate when several apply", async () => {
    h.rateFindMany.mockResolvedValue([
      { label: "Adult", amountCents: 18900, currency: "AUD", perGuest: true, isDefault: true, seasonStart: null, seasonEnd: null },
      { label: "Child", amountCents: 9900, currency: "AUD", perGuest: true, isDefault: false, seasonStart: null, seasonEnd: null },
    ]);
    const q = await quoteFor("L1", 2, onDate);
    expect(q?.lines[0].label).toBe("Adult");
  });
});

describe("seatsTaken", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  const departsAt = new Date("2026-07-16T22:00:00Z");

  it("adds confirmed seats and live holds, and drops expired ones", async () => {
    h.holdFindMany.mockResolvedValue([
      { seats: 4, confirmed: true, expiresAt: null },
      { seats: 2, confirmed: false, expiresAt: new Date("2026-07-01T01:00:00Z") },
      { seats: 6, confirmed: false, expiresAt: new Date("2026-06-30T23:00:00Z") },
    ]);
    expect(await seatsTaken("L1", departsAt, now)).toBe(6);
  });

  it("is zero when nothing is held", async () => {
    h.holdFindMany.mockResolvedValue([]);
    expect(await seatsTaken("L1", departsAt, now)).toBe(0);
  });
});
