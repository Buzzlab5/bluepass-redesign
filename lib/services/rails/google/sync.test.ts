import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { listDepartures } from "@/lib/services/operators/listing-availability";
import { cancelBooking, createOperatorBooking, reserveSeats } from "@/lib/services/rails/bookings";
import { calendarEventId, markDepartureChanged } from "@/lib/services/rails/calendar-events";
import {
  disconnectGoogle,
  liveBusyCheck,
  operatorCalendars,
  refreshBusyBlocks,
  saveConnection,
  syncOperatorCalendar,
} from "@/lib/services/rails/google/sync";
import { EARLY, fakeGoogle, fakePayments, resetRailsTables, seedOperator, THURSDAY_8AM } from "@/lib/services/rails/test-fixtures";

const BOAT = "boat@group.calendar.google.com";
// A charter in the operator's diary across the Thursday trip (08:00 to 16:00 Brisbane).
const CHARTER = { startsAt: new Date("2026-07-16T01:00:00Z"), endsAt: new Date("2026-07-16T05:00:00Z") };

beforeEach(async () => {
  await resetRailsTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function connected() {
  const seeded = await seedOperator();
  await prisma.operatorListing.update({ where: { id: seeded.listing.id }, data: { durationMinutes: 480 } });
  await saveConnection({ operatorProfileId: seeded.profile.id, refreshToken: "rt_kate", googleEmail: "kate@example.test", scopes: [], now: EARLY });
  return seeded;
}

async function phoneBooking(seeded: Awaited<ReturnType<typeof seedOperator>>, guests: number, name = "Mia Torres") {
  const r = await createOperatorBooking({
    operatorProfileId: seeded.profile.id, listingId: seeded.listing.id, departsAt: THURSDAY_8AM,
    quantities: { [seeded.adult.id]: guests }, lead: { name, phone: "+61 411 204 118" }, paid: false,
    sendConfirmation: false, actorEmail: "op", now: EARLY,
  });
  if (!r.ok) throw new Error(r.reason);
  return r.booking;
}

describe("writing departures to the operator's Google Calendar", () => {
  it("creates the Bluepass calendar once and keeps one event per departure current", async () => {
    const seeded = await connected();
    const { api, calls, calendars } = fakeGoogle();

    await phoneBooking(seeded, 2);
    expect(await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY })).toMatchObject({ status: "synced", written: 1 });
    await phoneBooking(seeded, 3, "James Whitfield");
    expect(await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY })).toMatchObject({ written: 1 });

    expect(calls.filter((c) => c.kind === "createCalendar")).toHaveLength(1);
    const [events] = [...calendars.values()];
    expect(events.size).toBe(1);
    const event = events.get(calendarEventId(seeded.listing.id, THURSDAY_8AM))!;
    expect(event.summary).toBe("Outer Reef Snorkel Day · 5 of 12");
    expect(event.description).toContain("Mia Torres · 2 Adult · +61411204118 · to collect A$378");
    expect(event.description).toContain("James Whitfield");
    expect(event.location).toBe("Marina Pier B, Cairns");
    expect(event.start).toEqual({ dateTime: "2026-07-15T22:00:00.000Z", timeZone: "Australia/Brisbane" });
    expect(event.end.dateTime).toBe("2026-07-16T06:00:00.000Z");
  });

  it("removes the event once nobody is booked on the departure", async () => {
    const seeded = await connected();
    const { api, calendars } = fakeGoogle();
    const booking = await phoneBooking(seeded, 2);
    await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY });

    await cancelBooking({ bookingId: booking.id, operatorProfileId: seeded.profile.id, actor: "op", reason: "x", now: EARLY }, fakePayments().payments);
    expect(await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY })).toMatchObject({ removed: 1 });
    expect([...calendars.values()][0].size).toBe(0);
    expect(await prisma.departureCalendarEvent.findFirstOrThrow()).toMatchObject({ googleEventId: null, dirtyAt: null });
  });

  it("writes everything already sold the first time an operator connects", async () => {
    const seeded = await seedOperator();
    await phoneBooking(seeded, 2);
    await saveConnection({ operatorProfileId: seeded.profile.id, refreshToken: "rt", googleEmail: "k@example.test", scopes: [], now: EARLY });
    const { api } = fakeGoogle();
    expect(await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY })).toMatchObject({ written: 1 });
  });

  it("recreates the calendar and rewrites every departure if the operator deleted it", async () => {
    const seeded = await connected();
    const { api, calls, calendars } = fakeGoogle();
    await phoneBooking(seeded, 2);
    await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY });

    calendars.clear();
    await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY });
    expect(calls.filter((c) => c.kind === "createCalendar")).toHaveLength(2);
    expect([...calendars.values()][0].size).toBe(1);
  });

  it("asks the operator to reconnect when Google withdraws access, and writes nothing", async () => {
    const seeded = await connected();
    await phoneBooking(seeded, 2);
    const { api, calls } = fakeGoogle({ revoked: true });
    expect(await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY })).toMatchObject({ status: "needs_reconnect" });
    expect(await prisma.operatorGoogleConnection.findFirstOrThrow()).toMatchObject({ status: "NEEDS_RECONNECT" });
    expect(calls.filter((c) => c.kind === "put")).toHaveLength(0);
    // The departure stays queued, so reconnecting brings the calendar straight up to date.
    expect((await prisma.departureCalendarEvent.findFirstOrThrow()).dirtyAt).not.toBeNull();
  });

  it("treats Google being unreachable as a retry, not a reason to make the operator reconnect", async () => {
    const seeded = await connected();
    await phoneBooking(seeded, 2);
    await expect(syncOperatorCalendar(seeded.profile.id, { api: fakeGoogle({ offline: true }).api, now: EARLY })).rejects.toThrow("fetch failed");
    expect(await prisma.operatorGoogleConnection.findFirstOrThrow()).toMatchObject({ status: "CONNECTED" });
    // Back online, the departure that was waiting goes straight in.
    expect(await syncOperatorCalendar(seeded.profile.id, { api: fakeGoogle().api, now: EARLY })).toMatchObject({ written: 1 });
  });

  it("costs an unconnected operator nothing", async () => {
    const seeded = await seedOperator();
    await markDepartureChanged(seeded.profile.id, seeded.listing.id, THURSDAY_8AM);
    expect(await prisma.departureCalendarEvent.count()).toBe(0);
  });

  it("never offers the Bluepass calendar itself as a source of busy time", async () => {
    const seeded = await connected();
    const { api } = fakeGoogle();
    await phoneBooking(seeded, 1);
    await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY });
    const calendars = await operatorCalendars(seeded.profile.id, api);
    expect(calendars?.map((c) => c.id)).toEqual(["kate@example.test", BOAT]);
  });
});

describe("busy time closing departures", () => {
  async function pointedAtBoat() {
    const seeded = await connected();
    await prisma.operatorListing.update({ where: { id: seeded.listing.id }, data: { busyCalendarId: BOAT } });
    return seeded;
  }

  it("closes a departure the operator's diary is busy across, and reopens it when the entry goes", async () => {
    const seeded = await pointedAtBoat();
    const google = fakeGoogle({ busy: { [BOAT]: [CHARTER] } });
    expect(await refreshBusyBlocks(seeded.profile.id, { api: google.api, now: EARLY })).toMatchObject({ blocks: 1 });

    const refused = await reserveSeats({ listingId: seeded.listing.id, departsAt: THURSDAY_8AM, quantities: { [seeded.adult.id]: 2 }, lead: { name: "Mia", email: "mia@example.test" }, source: "ONLINE", now: EARLY });
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.reason).toContain("not running");

    google.setBusy({ [BOAT]: [] });
    await refreshBusyBlocks(seeded.profile.id, { api: google.api, now: EARLY });
    const [day] = await listDepartures({ listingId: seeded.listing.id, from: "2026-07-16", to: "2026-07-16", now: EARLY });
    expect(day.departures[0]).toMatchObject({ busy: false, block: null });
  });

  it("still lets the operator take a phone booking on a busy departure", async () => {
    const seeded = await pointedAtBoat();
    await refreshBusyBlocks(seeded.profile.id, { api: fakeGoogle({ busy: { [BOAT]: [CHARTER] } }).api, now: EARLY });
    await expect(phoneBooking(seeded, 2)).resolves.toMatchObject({ status: "CONFIRMED" });
  });

  it("keeps the last known busy time when Google cannot read the calendar", async () => {
    const seeded = await pointedAtBoat();
    await refreshBusyBlocks(seeded.profile.id, { api: fakeGoogle({ busy: { [BOAT]: [CHARTER] } }).api, now: EARLY });
    const r = await refreshBusyBlocks(seeded.profile.id, { api: fakeGoogle({ unreadable: [BOAT] }).api, now: EARLY });
    expect(r.errors).toHaveLength(3);
    expect(await prisma.operatorBusyBlock.count()).toBe(1);
  });

  it("checks the diary live just before seats are held", async () => {
    const seeded = await pointedAtBoat();
    const { api } = fakeGoogle({ busy: { [BOAT]: [CHARTER] } });
    expect(await liveBusyCheck(seeded.listing.id, THURSDAY_8AM, { api })).toBe(true);
    expect(await prisma.operatorBusyBlock.count()).toBe(1);
    expect(await liveBusyCheck(seeded.listing.id, new Date("2026-07-17T22:00:00Z"), { api })).toBe(false);
  });

  it("forgets busy time and the chosen calendar when Google is disconnected", async () => {
    const seeded = await pointedAtBoat();
    const { api, calls } = fakeGoogle({ busy: { [BOAT]: [CHARTER] } });
    await phoneBooking(seeded, 2);
    await syncOperatorCalendar(seeded.profile.id, { api, now: EARLY });
    await refreshBusyBlocks(seeded.profile.id, { api, now: EARLY });

    await disconnectGoogle(seeded.profile.id, api);
    expect(calls.filter((c) => c.kind === "deleteCalendar")).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "revoke")).toHaveLength(1);
    expect(await prisma.operatorBusyBlock.count()).toBe(0);
    expect(await prisma.operatorGoogleConnection.count()).toBe(0);
    expect((await prisma.operatorListing.findUniqueOrThrow({ where: { id: seeded.listing.id } })).busyCalendarId).toBeNull();
  });
});
