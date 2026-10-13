import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  scheduleFindMany: vi.fn(),
  blackoutFindMany: vi.fn(),
  rateFindMany: vi.fn(),
  holdFindMany: vi.fn(),
  overrideFindMany: vi.fn(),
  listingFindUnique: vi.fn(),
  busyFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    listingSchedule: { findMany: h.scheduleFindMany },
    listingBlackout: { findMany: h.blackoutFindMany },
    listingRate: { findMany: h.rateFindMany },
    listingSeatHold: { findMany: h.holdFindMany },
    listingDepartureOverride: { findMany: h.overrideFindMany },
    operatorListing: { findUnique: h.listingFindUnique },
    operatorBusyBlock: { findMany: h.busyFindMany },
  },
}));

import {
  evaluateDeparture,
  overlapsBusy,
  listDepartures,
  localDateInZone,
  localTimeInZone,
  priceParty,
  quoteFor,
  ratesForDate,
  resolveAvailability,
  scheduledDepartures,
  seatsTaken,
  weekdayInZone,
  zonedTimeToUtc,
  type RateRule,
  type ScheduleRule,
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
  h.overrideFindMany.mockReset().mockResolvedValue([]);
  h.listingFindUnique.mockReset().mockResolvedValue(null);
  h.busyFindMany.mockReset().mockResolvedValue([]);
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

describe("departure overrides", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  // Thursday 2026-07-16, 08:00 Brisbane.
  const departsAt = new Date("2026-07-15T22:00:00Z");

  it("refuses a departure the operator has closed, without blaming the traveller", async () => {
    h.overrideFindMany.mockResolvedValue([{ departsAt, closed: true, capacity: null, note: "weather" }]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("not running that departure");
  });

  it("uses a raised capacity for that one departure", async () => {
    h.overrideFindMany.mockResolvedValue([{ departsAt, closed: false, capacity: 20, note: null }]);
    h.holdFindMany.mockResolvedValue([{ seats: 12, confirmed: true, expiresAt: null }]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 4, now });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.departures[0].seatsLeft).toBe(8);
  });
});

describe("evaluateDeparture", () => {
  const s = schedule() as unknown as ScheduleRule;
  const d = { schedule: s, departsAt: new Date("2026-07-15T22:00:00Z"), localTime: "08:00" };

  it("lets the operator book inside the cutoff, but never over capacity", () => {
    const morningOf = new Date("2026-07-15T20:00:00Z");
    expect(evaluateDeparture(d, { taken: 0, guests: 2, now: morningOf }).block).toBe("cutoff");
    expect(evaluateDeparture(d, { taken: 0, guests: 2, now: morningOf, ignoreWindow: true }).block).toBeNull();
    expect(evaluateDeparture(d, { taken: 11, guests: 2, now: morningOf, ignoreWindow: true }).block).toBe("full");
  });

  it("reports a closed departure as closed even when it has room", () => {
    const state = evaluateDeparture(d, {
      taken: 0, guests: 1, now: new Date("2026-07-01T00:00:00Z"),
      override: { departsAt: d.departsAt, closed: true, capacity: null, note: "swell" },
    });
    expect(state.block).toBe("closed");
    expect(state.note).toBe("swell");
    expect(state.seatsLeft).toBe(12);
  });
});

describe("scheduledDepartures", () => {
  it("expresses a one-off departure as a single-day season", () => {
    // How the operator adds a special trip outside the rule: a pattern whose season is one day.
    const oneOff = schedule({
      weekdays: [], departureTimes: ["17:30"],
      seasonStart: new Date("2026-12-31T00:00:00Z"), seasonEnd: new Date("2026-12-31T00:00:00Z"),
    }) as unknown as ScheduleRule;
    expect(scheduledDepartures([oneOff], "2026-12-31")).toHaveLength(1);
    expect(scheduledDepartures([oneOff], "2026-12-30")).toHaveLength(0);
    expect(scheduledDepartures([oneOff], "2027-01-01")).toHaveLength(0);
  });
});

describe("local date and time", () => {
  it("reads the operator's date, not UTC's", () => {
    // 22:00 UTC on the 15th is 08:00 on the 16th in Brisbane.
    const instant = new Date("2026-07-15T22:00:00Z");
    expect(localDateInZone(instant, BRISBANE)).toBe("2026-07-16");
    expect(localTimeInZone(instant, BRISBANE)).toBe("08:00");
  });

  it("round-trips a Bali departure through UTC", () => {
    const instant = zonedTimeToUtc("2026-07-16", "06:30", "Asia/Makassar");
    expect(localDateInZone(instant, "Asia/Makassar")).toBe("2026-07-16");
    expect(localTimeInZone(instant, "Asia/Makassar")).toBe("06:30");
  });
});

describe("priceParty", () => {
  function rate(over: Partial<RateRule>): RateRule {
    return {
      id: "r", label: "Adult", amountCents: 18900, currency: "AUD", perGuest: true,
      minAge: null, maxAge: null, seasonStart: null, seasonEnd: null, isDefault: false,
      active: true, ...over,
    };
  }
  const adult = rate({ id: "adult", label: "Adult", amountCents: 18900, isDefault: true });
  const child = rate({ id: "child", label: "Child 4 to 14", amountCents: 9900, minAge: 4, maxAge: 14 });
  const charter = rate({ id: "charter", label: "Private charter", amountCents: 240000, perGuest: false });
  const peak = rate({
    id: "peak", label: "Peak adult", amountCents: 22900,
    seasonStart: new Date("2026-12-15T00:00:00Z"), seasonEnd: new Date("2027-01-31T00:00:00Z"),
  });

  it("adds two adults and a child line by line", () => {
    const p = priceParty([adult, child], "2026-07-16", { quantities: { adult: 2, child: 1 } });
    expect(p).toMatchObject({ ok: true, guests: 3, totalCents: 47700, currency: "AUD" });
  });

  it("charges a charter once and takes the head count from the party", () => {
    const p = priceParty([charter], "2026-07-16", { quantities: { charter: 1 }, guests: 6 });
    expect(p).toMatchObject({ ok: true, guests: 6, totalCents: 240000 });
  });

  it("asks for a head count rather than assuming one for a charter", () => {
    const p = priceParty([charter], "2026-07-16", { quantities: { charter: 1 } });
    expect(p.ok).toBe(false);
  });

  it("refuses a seasonal price outside its season instead of substituting another", () => {
    const p = priceParty([adult, peak], "2026-07-16", { quantities: { peak: 2 } });
    expect(p).toMatchObject({ ok: false });
    expect(priceParty([adult, peak], "2026-12-20", { quantities: { peak: 2 } }))
      .toMatchObject({ ok: true, totalCents: 45800 });
  });

  it("refuses an empty party, a fractional guest and a rate it has never heard of", () => {
    expect(priceParty([adult], "2026-07-16", { quantities: {} }).ok).toBe(false);
    expect(priceParty([adult], "2026-07-16", { quantities: { adult: 1.5 } }).ok).toBe(false);
    expect(priceParty([adult], "2026-07-16", { quantities: { ghost: 1 } }).ok).toBe(false);
  });

  it("puts the default rate first, then the dearest", () => {
    expect(ratesForDate([child, adult, charter], "2026-07-16").map((r) => r.id))
      .toEqual(["adult", "charter", "child"]);
  });
});

describe("listDepartures", () => {
  const now = new Date("2026-07-01T00:00:00Z");

  it("lays out a week with sold seats netted per departure", async () => {
    h.holdFindMany.mockResolvedValue([
      { departsAt: new Date("2026-07-15T22:00:00Z"), seats: 5, confirmed: true, expiresAt: null },
    ]);
    const days = await listDepartures({ listingId: "L1", from: "2026-07-13", to: "2026-07-19", now });
    expect(days.map((d) => d.date)).toEqual([
      "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19",
    ]);
    // Tue 14th, Thu 16th, Sat 18th run.
    expect(days.filter((d) => d.departures.length > 0).map((d) => d.date))
      .toEqual(["2026-07-14", "2026-07-16", "2026-07-18"]);
    const thursday = days.find((d) => d.date === "2026-07-16")!;
    expect(thursday.departures[0]).toMatchObject({ taken: 5, seatsLeft: 7, block: null });
  });

  it("marks a blacked-out day with its reason and no departures", async () => {
    h.blackoutFindMany.mockResolvedValue([{
      startDate: new Date("2026-07-16T00:00:00Z"), endDate: new Date("2026-07-16T00:00:00Z"), reason: "Slipway",
    }]);
    const days = await listDepartures({ listingId: "L1", from: "2026-07-16", to: "2026-07-16", now });
    expect(days[0]).toMatchObject({ blackout: "Slipway", departures: [] });
  });
});

describe("listDepartures without a party size", () => {
  it("tests each departure against the smallest party it runs for", async () => {
    h.scheduleFindMany.mockResolvedValue([schedule({ minGuests: 2 })]);
    const now = new Date("2026-07-01T00:00:00Z");
    const [day] = await listDepartures({ listingId: "L1", from: "2026-07-16", to: "2026-07-16", now });
    expect(day.departures[0].block).toBeNull();
    const [single] = await listDepartures({ listingId: "L1", from: "2026-07-16", to: "2026-07-16", guests: 1, now });
    expect(single.departures[0].block).toBe("tooFew");
  });
});

describe("busy time from the operator's calendar", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  // Thursday 2026-07-16, 08:00 Brisbane is 2026-07-15T22:00Z.
  const charter = { startsAt: new Date("2026-07-16T01:00:00Z"), endsAt: new Date("2026-07-16T05:00:00Z") };

  it("counts the whole trip, not only the moment it leaves", () => {
    const departsAt = new Date("2026-07-15T22:00:00Z");
    // An 8 hour trip runs into an 11am charter; a 2 hour one is back in time.
    expect(overlapsBusy(departsAt, 8 * 60, [charter])).toBe(true);
    expect(overlapsBusy(departsAt, 120, [charter])).toBe(false);
    // Unknown length is checked as an hour.
    expect(overlapsBusy(departsAt, null, [charter])).toBe(false);
  });

  it("closes a busy departure to travellers and Kai, without naming why", async () => {
    h.listingFindUnique.mockResolvedValue({ busyCalendarId: "cal_boat", durationMinutes: 480, operatorProfileId: "op1" });
    h.busyFindMany.mockResolvedValue([charter]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toContain("not running that departure");
  });

  it("still shows the operator the departure, marked busy, in their own view", async () => {
    h.listingFindUnique.mockResolvedValue({ busyCalendarId: "cal_boat", durationMinutes: 480, operatorProfileId: "op1" });
    h.busyFindMany.mockResolvedValue([charter]);
    const [day] = await listDepartures({ listingId: "L1", from: "2026-07-16", to: "2026-07-16", now, ignoreWindow: true });
    expect(day.departures[0]).toMatchObject({ busy: true, block: null });
    const [publicDay] = await listDepartures({ listingId: "L1", from: "2026-07-16", to: "2026-07-16", now });
    expect(publicDay.departures[0]).toMatchObject({ busy: true, block: "closed" });
  });

  it("ignores busy time when no calendar is chosen for the trip", async () => {
    h.listingFindUnique.mockResolvedValue({ busyCalendarId: null, durationMinutes: 480, operatorProfileId: "op1" });
    h.busyFindMany.mockResolvedValue([charter]);
    const r = await resolveAvailability({ listingId: "L1", date: "2026-07-16", guests: 2, now });
    expect(r.available).toBe(true);
    expect(h.busyFindMany).not.toHaveBeenCalled();
  });
});
