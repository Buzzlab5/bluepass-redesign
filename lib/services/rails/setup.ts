import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  addDays,
  dayBounds,
  localDateInZone,
  scheduledDepartures,
  type ScheduleRule,
} from "@/lib/services/operators/listing-availability";
import { formatDepartureShort, formatClock, OPERATOR_TIMEZONES } from "@/lib/services/rails/format";

/**
 * What an operator states once so their trip can be sold without them: when it
 * runs, what it costs, when it does not run, and where guests meet.
 *
 * Every edit here is checked against bookings already sold. Changing a schedule
 * so that a booked departure no longer exists would leave real guests holding
 * tickets for a boat the calendar says is not going, and nobody would notice
 * until they turned up at the jetty. So such an edit is refused, and the refusal
 * names the departures in the way.
 */

export type SetupResult = { ok: true; message: string } | { ok: false; message: string; field?: string };

const ok = (message: string): SetupResult => ({ ok: true, message });
const no = (message: string, field?: string): SetupResult => ({ ok: false, message, field });

async function ownedListing(listingId: string, operatorProfileId: string) {
  const listing = await prisma.operatorListing.findUnique({ where: { id: listingId } });
  return listing && listing.operatorProfileId === operatorProfileId ? listing : null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const zones = new Set(OPERATOR_TIMEZONES.map((z) => z.value));

function isoDate(value: string | null | undefined): Date | null {
  if (!value || !DATE.test(value)) return null;
  return dayBounds(value).start;
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export const scheduleInputSchema = z.object({
  label: z.string().trim().max(80).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  departureTimes: z
    .array(z.string().regex(TIME, "Times are 24 hour, like 08:00 or 13:30."))
    .min(1, "Add at least one departure time.")
    .max(12, "That is more departures a day than this form takes."),
  capacityPerDeparture: z.number().int().min(1, "A departure needs at least one seat.").max(1000),
  minGuests: z.number().int().min(1).max(1000),
  cutoffHours: z.number().int().min(0).max(24 * 30),
  maxAdvanceDays: z.number().int().min(1).max(730),
  timezone: z.string().refine((z) => zones.has(z), "Pick the zone the boat leaves from."),
  seasonStart: z.string().regex(DATE).nullable(),
  seasonEnd: z.string().regex(DATE).nullable(),
});

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

type FutureBooking = { departsAt: Date; guests: number; reference: string };

async function futureBookingsOn(scheduleId: string, now: Date): Promise<FutureBooking[]> {
  return prisma.listingBooking.findMany({
    where: { scheduleId, departsAt: { gt: now }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
    select: { departsAt: true, guests: true, reference: true },
  });
}

/**
 * The departures of a future booking that a proposed pattern would no longer
 * produce, or would produce with too few seats. Empty means the edit is safe.
 */
export function conflictsWithBookings(rule: ScheduleRule, bookings: FutureBooking[]): string[] {
  const byDeparture = new Map<number, FutureBooking[]>();
  for (const b of bookings) byDeparture.set(b.departsAt.getTime(), [...(byDeparture.get(b.departsAt.getTime()) ?? []), b]);

  const problems: string[] = [];
  for (const [instant, group] of byDeparture) {
    const departsAt = new Date(instant);
    const date = localDateInZone(departsAt, rule.timezone);
    const still = scheduledDepartures([rule], date).some((d) => d.departsAt.getTime() === instant);
    const when = `${formatDepartureShort(departsAt, rule.timezone)}, ${formatClock(departsAt, rule.timezone)}`;
    const seats = group.reduce((n, b) => n + b.guests, 0);
    if (!still || seats > rule.capacityPerDeparture) problems.push(`${when} (${seats} booked)`);
  }
  return problems.sort();
}

function conflictMessage(problems: string[], change: "edit" | "remove") {
  const shown = problems.slice(0, 3).join("; ");
  const more = problems.length > 3 ? `, and ${problems.length - 3} more` : "";
  return change === "edit"
    ? `Guests are booked on departures this change would remove or overfill: ${shown}${more}. Cancel or close those departures first, or keep them in the pattern.`
    : `Guests are booked on upcoming departures of this pattern: ${shown}${more}. Cancel those departures first.`;
}

export async function saveSchedule(input: {
  operatorProfileId: string;
  listingId: string;
  scheduleId?: string | null;
  values: ScheduleInput;
  now?: Date;
}): Promise<SetupResult> {
  const now = input.now ?? new Date();
  const listing = await ownedListing(input.listingId, input.operatorProfileId);
  if (!listing) return no("That trip is not one of yours.");

  const parsed = scheduleInputSchema.safeParse(input.values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return no(issue?.message ?? "Check the schedule and try again.", String(issue?.path[0] ?? ""));
  }
  const v = parsed.data;
  const seasonStart = isoDate(v.seasonStart);
  const seasonEnd = isoDate(v.seasonEnd);
  if (seasonStart && seasonEnd && seasonEnd < seasonStart) return no("The season ends before it starts.", "seasonEnd");
  if (v.minGuests > v.capacityPerDeparture) return no("The minimum to run is more than the boat holds.", "minGuests");

  const data = {
    label: v.label || null,
    weekdays: [...new Set(v.weekdays)].sort(),
    departureTimes: [...new Set(v.departureTimes)].sort(),
    capacityPerDeparture: v.capacityPerDeparture,
    minGuests: v.minGuests,
    cutoffHours: v.cutoffHours,
    maxAdvanceDays: v.maxAdvanceDays,
    timezone: v.timezone,
    seasonStart,
    seasonEnd,
  };

  if (input.scheduleId) {
    const existing = await prisma.listingSchedule.findUnique({ where: { id: input.scheduleId } });
    if (!existing || existing.listingId !== listing.id) return no("That schedule is not part of this trip.");
    const problems = conflictsWithBookings({ ...existing, ...data }, await futureBookingsOn(existing.id, now));
    if (problems.length > 0) return no(conflictMessage(problems, "edit"));
    await prisma.listingSchedule.update({ where: { id: existing.id }, data });
    return ok("Schedule saved. The calendar and booking page follow it from now on.");
  }

  await prisma.listingSchedule.create({ data: { ...data, listingId: listing.id } });
  return ok("Schedule added.");
}

export async function removeSchedule(input: { operatorProfileId: string; listingId: string; scheduleId: string; now?: Date }): Promise<SetupResult> {
  const listing = await ownedListing(input.listingId, input.operatorProfileId);
  if (!listing) return no("That trip is not one of yours.");
  const existing = await prisma.listingSchedule.findUnique({ where: { id: input.scheduleId } });
  if (!existing || existing.listingId !== listing.id) return no("That schedule is not part of this trip.");

  const booked = await futureBookingsOn(existing.id, input.now ?? new Date());
  if (booked.length > 0) {
    const problems = conflictsWithBookings({ ...existing, weekdays: [], departureTimes: [] }, booked);
    return no(conflictMessage(problems, "remove"));
  }
  // Deactivated, not deleted: past bookings still point at it for their history.
  await prisma.listingSchedule.update({ where: { id: existing.id }, data: { active: false } });
  return ok("Schedule removed.");
}

/**
 * A special trip outside the usual pattern: a New Year's Eve cruise, a whale-season
 * extra. Stored as a pattern whose season is a single day, so it needs no model of
 * its own and every reader of the rule already understands it.
 */
export async function addOneOffDeparture(input: {
  operatorProfileId: string;
  listingId: string;
  date: string;
  time: string;
  capacity: number;
  timezone: string;
}): Promise<SetupResult> {
  if (!DATE.test(input.date)) return no("Pick a date.", "date");
  return saveSchedule({
    operatorProfileId: input.operatorProfileId,
    listingId: input.listingId,
    values: {
      label: "One-off departure",
      weekdays: [],
      departureTimes: [input.time],
      capacityPerDeparture: input.capacity,
      minGuests: 1,
      cutoffHours: 2,
      maxAdvanceDays: 730,
      timezone: input.timezone,
      seasonStart: input.date,
      seasonEnd: input.date,
    },
  });
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export const rateInputSchema = z.object({
  label: z.string().trim().min(1, "Name this price, like Adult or Child.").max(60),
  amount: z.number().positive("A price has to be more than zero.").max(1_000_000),
  perGuest: z.boolean(),
  minAge: z.number().int().min(0).max(120).nullable(),
  maxAge: z.number().int().min(0).max(120).nullable(),
  seasonStart: z.string().regex(DATE).nullable(),
  seasonEnd: z.string().regex(DATE).nullable(),
  isDefault: z.boolean(),
});

export type RateInput = z.infer<typeof rateInputSchema>;

/**
 * Prices are never edited in place once anyone has paid them: a booking copies its
 * lines when it is made, so changing a rate only ever changes what is charged next.
 */
export async function saveRate(input: {
  operatorProfileId: string;
  listingId: string;
  rateId?: string | null;
  values: RateInput;
}): Promise<SetupResult> {
  const listing = await ownedListing(input.listingId, input.operatorProfileId);
  if (!listing) return no("That trip is not one of yours.");

  const parsed = rateInputSchema.safeParse(input.values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return no(issue?.message ?? "Check the price and try again.", String(issue?.path[0] ?? ""));
  }
  const v = parsed.data;
  if (v.minAge !== null && v.maxAge !== null && v.maxAge < v.minAge) return no("The age range is upside down.", "maxAge");
  const seasonStart = isoDate(v.seasonStart);
  const seasonEnd = isoDate(v.seasonEnd);
  if (seasonStart && seasonEnd && seasonEnd < seasonStart) return no("The season ends before it starts.", "seasonEnd");

  const data = {
    label: v.label,
    amountCents: Math.round(v.amount * 100),
    currency: listing.currency,
    perGuest: v.perGuest,
    minAge: v.minAge,
    maxAge: v.maxAge,
    seasonStart,
    seasonEnd,
  };

  if (input.rateId) {
    const existing = await prisma.listingRate.findUnique({ where: { id: input.rateId } });
    if (!existing || existing.listingId !== listing.id || !existing.active) return no("That price is not part of this trip.");
  }

  await prisma.$transaction(async (tx) => {
    let id = input.rateId ?? null;
    if (id) {
      await tx.listingRate.update({ where: { id }, data });
    } else {
      id = (await tx.listingRate.create({ data: { ...data, listingId: listing.id } })).id;
    }

    // Exactly one default, which is what Kai quotes when nobody has said who is coming.
    const hasOtherDefault = await tx.listingRate.count({ where: { listingId: listing.id, active: true, isDefault: true, NOT: { id } } });
    if (v.isDefault || hasOtherDefault === 0) {
      await tx.listingRate.updateMany({ where: { listingId: listing.id, NOT: { id } }, data: { isDefault: false } });
      await tx.listingRate.update({ where: { id }, data: { isDefault: true } });
    } else {
      await tx.listingRate.update({ where: { id }, data: { isDefault: false } });
    }

    // Keep the "From A$189" on Discover honest: it is the cheapest per-guest price on offer.
    const cheapest = await tx.listingRate.findFirst({
      where: { listingId: listing.id, active: true, perGuest: true },
      orderBy: { amountCents: "asc" },
    });
    if (cheapest) await tx.operatorListing.update({ where: { id: listing.id }, data: { priceFrom: cheapest.amountCents / 100 } });
  });

  return ok("Price saved. It applies to bookings from now on.");
}

export async function removeRate(input: { operatorProfileId: string; listingId: string; rateId: string }): Promise<SetupResult> {
  const listing = await ownedListing(input.listingId, input.operatorProfileId);
  if (!listing) return no("That trip is not one of yours.");
  const rate = await prisma.listingRate.findUnique({ where: { id: input.rateId } });
  if (!rate || rate.listingId !== listing.id) return no("That price is not part of this trip.");

  await prisma.$transaction(async (tx) => {
    await tx.listingRate.update({ where: { id: rate.id }, data: { active: false, isDefault: false } });
    if (rate.isDefault) {
      const next = await tx.listingRate.findFirst({ where: { listingId: listing.id, active: true }, orderBy: { amountCents: "desc" } });
      if (next) await tx.listingRate.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  return ok("Price removed. Bookings already made keep the price they were sold at.");
}

// ---------------------------------------------------------------------------
// Closed dates
// ---------------------------------------------------------------------------

export async function addBlackout(input: {
  operatorProfileId: string;
  listingId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  now?: Date;
}): Promise<SetupResult> {
  const listing = await ownedListing(input.listingId, input.operatorProfileId);
  if (!listing) return no("That trip is not one of yours.");
  const start = isoDate(input.startDate);
  const end = isoDate(input.endDate || input.startDate);
  if (!start) return no("Pick the first closed day.", "startDate");
  if (!end || end < start) return no("The last closed day is before the first.", "endDate");
  if (end.getTime() - start.getTime() > 366 * 86_400_000) return no("Close a year or less at a time.", "endDate");

  // Booked departures inside the range would vanish from the calendar while their
  // guests still expect to sail. Name them instead.
  const booked = await prisma.listingBooking.findMany({
    where: {
      listingId: listing.id,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
      departsAt: { gte: new Date(start.getTime() - 86_400_000), lte: new Date(end.getTime() + 2 * 86_400_000) },
    },
    select: { departsAt: true, timezone: true, guests: true },
  });
  const inside = booked.filter((b) => {
    const local = localDateInZone(b.departsAt, b.timezone);
    return local >= input.startDate && local <= (input.endDate || input.startDate);
  });
  if (inside.length > 0) {
    const days = [...new Set(inside.map((b) => formatDepartureShort(b.departsAt, b.timezone)))].slice(0, 3).join(", ");
    return no(`Guests are booked on ${days}. Cancel those departures from the calendar first, so they are told and refunded.`);
  }

  await prisma.listingBlackout.create({
    data: { listingId: listing.id, startDate: start, endDate: end, reason: input.reason?.trim().slice(0, 120) || null },
  });
  return ok("Closed. Those dates are off the booking page.");
}

export async function removeBlackout(input: { operatorProfileId: string; listingId: string; blackoutId: string }): Promise<SetupResult> {
  const listing = await ownedListing(input.listingId, input.operatorProfileId);
  if (!listing) return no("That trip is not one of yours.");
  const blackout = await prisma.listingBlackout.findUnique({ where: { id: input.blackoutId } });
  if (!blackout || blackout.listingId !== listing.id) return no("Those dates are not part of this trip.");
  await prisma.listingBlackout.delete({ where: { id: blackout.id } });
  return ok("Reopened.");
}

// ---------------------------------------------------------------------------
// On the day
// ---------------------------------------------------------------------------

export async function saveLogistics(input: {
  operatorProfileId: string;
  listingId: string;
  durationMinutes: number | null;
  meetingPoint: string | null;
  confirmationNote: string | null;
}): Promise<SetupResult> {
  const listing = await ownedListing(input.listingId, input.operatorProfileId);
  if (!listing) return no("That trip is not one of yours.");
  if (input.durationMinutes !== null && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 60 * 24 * 21)) {
    return no("Give the length in hours and minutes.", "durationMinutes");
  }
  await prisma.operatorListing.update({
    where: { id: listing.id },
    data: {
      durationMinutes: input.durationMinutes,
      meetingPoint: input.meetingPoint?.trim().slice(0, 200) || null,
      confirmationNote: input.confirmationNote?.trim().slice(0, 1200) || null,
    },
  });
  return ok("Saved. Every confirmation from now on carries it.");
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

export type TripReadiness = {
  live: boolean;
  hasSchedule: boolean;
  hasPrice: boolean;
  hasMeetingPoint: boolean;
  /** Where the seats live: NATIVE, REZDY or FAREHARBOR. */
  channel: string;
  /** Why a Rezdy or FareHarbor trip cannot sell, in words the operator can act on. */
  channelIssue: string | null;
  /** Bookable online: live, and either a pattern and a price here, or a channel that can sell it. */
  bookable: boolean;
};

export function readiness(
  listing: { status: string; meetingPoint: string | null; channel?: string; channelIssue?: string | null },
  schedules: number,
  rates: number,
): TripReadiness {
  const live = listing.status === "LIVE";
  const channel = listing.channel ?? "NATIVE";
  const channelIssue = listing.channelIssue ?? null;
  return {
    live,
    hasSchedule: schedules > 0,
    hasPrice: rates > 0,
    hasMeetingPoint: Boolean(listing.meetingPoint),
    channel,
    channelIssue,
    bookable: channel === "NATIVE" ? live && schedules > 0 && rates > 0 : live && !channelIssue,
  };
}

export async function loadTripSetup(listingId: string, operatorProfileId: string, now = new Date()) {
  const listing = await prisma.operatorListing.findUnique({
    where: { id: listingId },
    include: {
      schedules: { where: { active: true }, orderBy: { createdAt: "asc" } },
      rates: { where: { active: true }, orderBy: [{ isDefault: "desc" }, { amountCents: "desc" }] },
      blackouts: { orderBy: { startDate: "asc" } },
    },
  });
  if (!listing || listing.operatorProfileId !== operatorProfileId) return null;

  const today = localDateInZone(now, listing.schedules[0]?.timezone ?? "Australia/Brisbane");
  const yesterday = dayBounds(addDays(today, -1)).start;
  return {
    listing,
    schedules: listing.schedules,
    rates: listing.rates,
    blackouts: listing.blackouts.filter((b) => b.endDate >= yesterday),
    readiness: readiness(listing, listing.schedules.length, listing.rates.length),
  };
}

export async function loadTripsOverview(operatorProfileId: string) {
  const listings = await prisma.operatorListing.findMany({
    where: { operatorProfileId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { schedules: { where: { active: true } }, rates: { where: { active: true } } } },
    },
  });
  return listings.map((l) => ({
    id: l.id,
    slug: l.slug,
    title: l.title,
    region: l.region,
    status: l.status,
    heroImageUrl: l.heroImageUrl,
    readiness: readiness(l, l._count.schedules, l._count.rates),
  }));
}
