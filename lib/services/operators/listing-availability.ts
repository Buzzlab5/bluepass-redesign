import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * Answers "can this party book this listing on this date" without asking the
 * operator.
 *
 * That sentence is the whole point of the module. Kai already runs the enquiry
 * flow, but with no inventory behind it the only honest thing it can do about a
 * date is escalate to the operator, and a human answering bookings is exactly
 * what the automatic-only rule exists to prevent. These rails are what let Kai
 * answer instead.
 *
 * Departures are derived from the operator's recurring schedule rather than read
 * from stored calendar rows. An operator who has never kept a booking calendar
 * will not start keeping one, so anything that needs weekly upkeep is a system
 * they will abandon in a month and we will be back to phoning them.
 *
 * Every refusal carries a reason written to be repeated to a traveller verbatim.
 * A refusal Kai cannot explain becomes a message to the operator, which puts the
 * human back in the loop through the side door.
 *
 * The rule itself is evaluated by pure functions (`scheduledDepartures`,
 * `evaluateDeparture`, `priceParty`) that the single-date check below, the
 * operator's calendar and the booking write path all share. Three callers with
 * their own copy of the rule would sooner or later disagree about whether a seat
 * exists, and the one that says yes would be the one taking money.
 */

export type DepartureOption = {
  scheduleId: string;
  /** The exact departure instant, in UTC. */
  departsAt: Date;
  /** Local clock time at the operator, e.g. "08:00". */
  localTime: string;
  seatsLeft: number;
};

export type Quote = {
  totalCents: number;
  currency: string;
  /** Per-line breakdown, so a traveller can be told how the figure was reached. */
  lines: { label: string; amountCents: number; quantity: number }[];
};

export type AvailabilityResult =
  | { available: true; departures: DepartureOption[]; quote: Quote | null }
  | { available: false; reason: string };

export type AvailabilityQuery = {
  listingId: string;
  /** Local calendar date at the operator, "YYYY-MM-DD". */
  date: string;
  guests: number;
  /** Injectable for tests and for quoting a date relative to a known instant. */
  now?: Date;
};

/** The schedule fields the rule reads. A Prisma `ListingSchedule` row satisfies it. */
export type ScheduleRule = {
  id: string;
  label?: string | null;
  weekdays: number[];
  departureTimes: string[];
  seasonStart: Date | null;
  seasonEnd: Date | null;
  capacityPerDeparture: number;
  minGuests: number;
  cutoffHours: number;
  maxAdvanceDays: number;
  timezone: string;
};

export type BlackoutRule = { startDate: Date; endDate: Date; reason: string | null };

export type DepartureOverrideRule = {
  departsAt: Date;
  closed: boolean;
  capacity: number | null;
  note: string | null;
};

export type HoldRow = { seats: number; confirmed: boolean; expiresAt: Date | null };

/** Time the operator is busy in their own calendar, read from Google FreeBusy. */
export type BusyInterval = { startsAt: Date; endsAt: Date };

/** A trip with no stated length is checked against busy time as if it ran an hour. */
const DEFAULT_TRIP_MINUTES = 60;

/**
 * Whether a departure overlaps time the operator is busy. The whole trip counts, not
 * just the moment it leaves: a charter booked from 1pm closes a noon departure that
 * would still be at sea.
 */
export function overlapsBusy(departsAt: Date, durationMinutes: number | null | undefined, busy: BusyInterval[]): boolean {
  const start = departsAt.getTime();
  const end = start + Math.max(1, durationMinutes ?? DEFAULT_TRIP_MINUTES) * 60_000;
  return busy.some((b) => b.startsAt.getTime() < end && b.endsAt.getTime() > start);
}

const DAY_MS = 86_400_000;

/**
 * The UTC instant for a local wall-clock time in an IANA zone.
 *
 * Done with Intl rather than a date library because the repo carries none, and
 * getting this wrong is not cosmetic: an hour of drift around a cutoff either
 * sells a seat on a boat that has left or refuses one that is still loading.
 *
 * The offset is resolved by formatting a provisional instant back in the target
 * zone and measuring the gap, then applying it once more to catch the case where
 * the first guess landed on the other side of a daylight-saving change.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm, 0, 0);

  const offsetAt = (instant: number) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(instant)).filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day,
      parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
    return asUtc - instant;
  };

  let guess = wanted - offsetAt(wanted);
  guess = wanted - offsetAt(guess);
  return new Date(guess);
}

/** Weekday 0-6 (Sunday first) for a local date in a zone. */
export function weekdayInZone(date: string, timeZone: string): number {
  const utc = zonedTimeToUtc(date, "12:00", timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(utc);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** The local calendar date ("YYYY-MM-DD") an instant falls on in a zone. */
export function localDateInZone(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is the one shape every caller here wants.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

/** The local clock time ("HH:MM", 24 hour) of an instant in a zone. */
export function localTimeInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(instant);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

/** "YYYY-MM-DD" plus a number of days, on the calendar rather than the clock. */
export function addDays(date: string, days: number): string {
  const { start } = dayBounds(date);
  return formatDate(new Date(start.getTime() + days * DAY_MS));
}

/**
 * Calendar dates are stored as UTC midnight, the same convention the schedule's
 * season and the blackout ranges use, so a date compares against them directly.
 */
export function dayBounds(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return { start, end: new Date(start.getTime() + DAY_MS - 1) };
}

function inSeason(date: Date, from: Date | null, to: Date | null): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Seats a set of holds occupies at `now`: confirmed seats plus holds that have not lapsed. */
export function countTaken(holds: HoldRow[], now: Date): number {
  return holds
    .filter((h) => h.confirmed || !h.expiresAt || h.expiresAt > now)
    .reduce((n, h) => n + h.seats, 0);
}

// ---------------------------------------------------------------------------
// The rule, as pure functions
// ---------------------------------------------------------------------------

export type ScheduledDeparture = {
  schedule: ScheduleRule;
  departsAt: Date;
  localTime: string;
};

export type Misses = {
  season: number;
  weekday: number;
  cutoff: number;
  advance: number;
  full: number;
  closed: number;
};

export function emptyMisses(): Misses {
  return { season: 0, weekday: 0, cutoff: 0, advance: 0, full: 0, closed: 0 };
}

/**
 * Every departure the operator's patterns produce on a local date, before the
 * clock, capacity or party size are considered. Blackouts are the caller's to
 * apply, because a blackout refuses the whole day with its own reason.
 *
 * `misses` is filled in with why patterns produced nothing, so a refusal can name
 * the real obstacle.
 */
export function scheduledDepartures(
  schedules: ScheduleRule[],
  date: string,
  misses: Misses = emptyMisses(),
): ScheduledDeparture[] {
  const { start: dayStart } = dayBounds(date);
  const out: ScheduledDeparture[] = [];

  for (const s of schedules) {
    if (!inSeason(dayStart, s.seasonStart, s.seasonEnd)) { misses.season++; continue; }

    const wd = weekdayInZone(date, s.timezone);
    if (s.weekdays.length > 0 && !s.weekdays.includes(wd)) { misses.weekday++; continue; }

    for (const time of s.departureTimes) {
      out.push({ schedule: s, departsAt: zonedTimeToUtc(date, time, s.timezone), localTime: time });
    }
  }

  return out.sort((a, b) => a.departsAt.getTime() - b.departsAt.getTime());
}

export type DepartureBlock = "closed" | "cutoff" | "advance" | "full";

export type DepartureState = {
  scheduleId: string;
  scheduleLabel: string | null;
  departsAt: Date;
  localTime: string;
  capacity: number;
  /** The schedule's own capacity, before any override for this departure. */
  ruleCapacity: number;
  taken: number;
  seatsLeft: number;
  /** Guests the whole departure needs, across every booking, to run. Never a rule about one booking. */
  minGuests: number;
  closed: boolean;
  /** The operator's own calendar shows them busy across this departure. */
  busy: boolean;
  note: string | null;
  /** Null when this party can book it; otherwise the first thing in the way. */
  block: DepartureBlock | null;
};

/**
 * Whether one departure can take one party right now.
 *
 * `ignoreWindow` is for the operator's own bookings: someone phoning the morning
 * of a trip is a booking the skipper will happily take, and the cutoff exists to
 * protect the manifest from strangers, not from the person writing it. Capacity
 * and closures still apply to everyone.
 *
 * Busy time from the operator's own calendar closes a departure to everyone but the
 * operator, for the same reason: they know what the entry in their diary means, and
 * a phone booking they choose to take is theirs to take.
 */
export function evaluateDeparture(
  d: ScheduledDeparture,
  ctx: {
    taken: number;
    override?: DepartureOverrideRule | null;
    guests: number;
    now: Date;
    ignoreWindow?: boolean;
    busy?: boolean;
  },
): DepartureState {
  const s = d.schedule;
  const capacity = ctx.override?.capacity ?? s.capacityPerDeparture;
  const seatsLeft = Math.max(0, capacity - ctx.taken);
  const untilDeparture = d.departsAt.getTime() - ctx.now.getTime();

  let block: DepartureBlock | null = null;
  if (ctx.override?.closed) block = "closed";
  else if (ctx.busy && !ctx.ignoreWindow) block = "closed";
  else if (!ctx.ignoreWindow && untilDeparture > s.maxAdvanceDays * DAY_MS) block = "advance";
  else if (!ctx.ignoreWindow && untilDeparture < s.cutoffHours * 3_600_000) block = "cutoff";
  else if (seatsLeft < ctx.guests) block = "full";

  return {
    scheduleId: s.id,
    scheduleLabel: s.label ?? null,
    departsAt: d.departsAt,
    localTime: d.localTime,
    capacity,
    ruleCapacity: s.capacityPerDeparture,
    taken: ctx.taken,
    seatsLeft,
    minGuests: s.minGuests,
    closed: Boolean(ctx.override?.closed),
    busy: Boolean(ctx.busy),
    note: ctx.override?.note ?? null,
    block,
  };
}

/** The blackout covering a local date, if any. */
export function blackoutOn(blackouts: BlackoutRule[], date: string): BlackoutRule | null {
  const { start } = dayBounds(date);
  return blackouts.find((b) => b.startDate <= start && b.endDate >= start) ?? null;
}

export function blackoutReason(b: BlackoutRule): string {
  const back = formatDate(new Date(b.endDate.getTime() + DAY_MS));
  return b.reason
    ? `Not running on that date: ${b.reason}. Back on ${back}.`
    : `Not running on that date. Back on ${back}.`;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** The rate fields pricing reads. A Prisma `ListingRate` row satisfies it. */
export type RateRule = {
  id: string;
  label: string;
  amountCents: number;
  currency: string;
  perGuest: boolean;
  minAge: number | null;
  maxAge: number | null;
  seasonStart: Date | null;
  seasonEnd: Date | null;
  isDefault: boolean;
  active?: boolean;
};

/** Rates a traveller can choose on a date: active and in season, default first. */
export function ratesForDate<R extends RateRule>(rates: R[], date: string): R[] {
  const { start } = dayBounds(date);
  return rates
    .filter((r) => r.active !== false && inSeason(start, r.seasonStart, r.seasonEnd))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.amountCents - a.amountCents);
}

export type PricedLine = {
  rateId: string;
  label: string;
  amountCents: number;
  quantity: number;
  perGuest: boolean;
};

export type PricedParty =
  | { ok: true; guests: number; totalCents: number; currency: string; lines: PricedLine[] }
  | { ok: false; reason: string };

/**
 * Prices a party from the rates a traveller actually picked: two adults and a
 * child, or a private charter for six.
 *
 * Every figure comes from a rate row the operator wrote. A rate that is not on
 * offer for the date is refused rather than substituted, for the same reason
 * `quoteFor` returns null: a price nobody agreed to is one somebody has to honour.
 *
 * Seats are the per-guest quantities. A flat rate (a whole-boat charter) charges
 * once and takes its seat count from `guests`, because "how many of you" and
 * "how many charters" are different questions.
 */
export function priceParty(
  rates: RateRule[],
  date: string,
  selection: { quantities: Record<string, number>; guests?: number },
): PricedParty {
  const onOffer = new Map(ratesForDate(rates, date).map((r) => [r.id, r]));
  const lines: PricedLine[] = [];
  let perGuestSeats = 0;
  let flatChosen = false;

  for (const [rateId, raw] of Object.entries(selection.quantities)) {
    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 500) {
      return { ok: false, reason: "That number of guests is not one we can book." };
    }
    if (quantity === 0) continue;

    const rate = onOffer.get(rateId);
    if (!rate) return { ok: false, reason: "One of those prices is not on offer for that date." };

    if (rate.perGuest) {
      perGuestSeats += quantity;
      lines.push({ rateId, label: rate.label, amountCents: rate.amountCents, quantity, perGuest: true });
    } else {
      if (quantity !== 1) return { ok: false, reason: `${rate.label} is booked once per group.` };
      flatChosen = true;
      lines.push({ rateId, label: rate.label, amountCents: rate.amountCents, quantity: 1, perGuest: false });
    }
  }

  if (lines.length === 0) return { ok: false, reason: "Choose at least one guest." };

  const currencies = new Set(lines.map((l) => onOffer.get(l.rateId)!.currency));
  if (currencies.size > 1) {
    return { ok: false, reason: "Those prices are in different currencies and cannot be combined." };
  }

  let guests = perGuestSeats;
  if (flatChosen) {
    const stated = Math.floor(Number(selection.guests ?? 0));
    if (!(stated >= 1)) return { ok: false, reason: "Say how many people are coming." };
    guests = Math.max(stated, perGuestSeats);
  }

  return {
    ok: true,
    guests,
    totalCents: lines.reduce((sum, l) => sum + l.amountCents * l.quantity, 0),
    currency: [...currencies][0],
    lines,
  };
}

/**
 * Prices a party from the listing's rate rows.
 *
 * Returns null rather than guessing when no rate applies. A quote invented from
 * an absent rate is worse than no quote: it is a price the operator never agreed
 * to and may have to honour.
 */
export async function quoteFor(
  listingId: string,
  guests: number,
  onDate: Date,
): Promise<Quote | null> {
  const rates = await prisma.listingRate.findMany({
    where: { listingId, active: true },
    orderBy: [{ isDefault: "desc" }, { amountCents: "asc" }],
  });
  const applicable = rates.filter((r) => inSeason(onDate, r.seasonStart, r.seasonEnd));
  if (applicable.length === 0) return null;

  // Without ages for the party, the default rate is the only defensible choice.
  const rate = applicable.find((r) => r.isDefault) ?? applicable[0];
  const quantity = rate.perGuest ? guests : 1;
  return {
    totalCents: rate.amountCents * quantity,
    currency: rate.currency,
    lines: [{ label: rate.label, amountCents: rate.amountCents, quantity }],
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

type BusyDb = Pick<Prisma.TransactionClient, "operatorListing" | "operatorBusyBlock">;

/**
 * The busy time that applies to one listing across a window, and how long its trips
 * run. Empty unless the operator has pointed the listing at one of their calendars.
 */
export async function busyFor(
  listingId: string,
  windowStart: Date,
  windowEnd: Date,
  db: BusyDb = prisma,
): Promise<{ intervals: BusyInterval[]; durationMinutes: number | null }> {
  const listing = await db.operatorListing.findUnique({
    where: { id: listingId },
    select: { busyCalendarId: true, durationMinutes: true, operatorProfileId: true },
  });
  if (!listing?.busyCalendarId) return { intervals: [], durationMinutes: listing?.durationMinutes ?? null };
  const intervals = await db.operatorBusyBlock.findMany({
    where: {
      operatorProfileId: listing.operatorProfileId,
      calendarId: listing.busyCalendarId,
      startsAt: { lt: windowEnd },
      endsAt: { gt: windowStart },
    },
    select: { startsAt: true, endsAt: true },
  });
  return { intervals, durationMinutes: listing.durationMinutes };
}

/** Seats already taken on a departure: confirmed seats plus holds that have not expired. */
export async function seatsTaken(listingId: string, departsAt: Date, now: Date): Promise<number> {
  const holds = await prisma.listingSeatHold.findMany({
    where: { listingId, departsAt },
    select: { seats: true, confirmed: true, expiresAt: true },
  });
  return countTaken(holds, now);
}

export async function resolveAvailability(q: AvailabilityQuery): Promise<AvailabilityResult> {
  const now = q.now ?? new Date();
  const guests = Math.max(1, Math.floor(q.guests));

  const schedules = await prisma.listingSchedule.findMany({
    where: { listingId: q.listingId, active: true },
  });
  if (schedules.length === 0) {
    return { available: false, reason: "This trip does not have bookable dates loaded yet." };
  }

  const { start: dayStart } = dayBounds(q.date);

  const blackouts = await prisma.listingBlackout.findMany({
    where: { listingId: q.listingId, startDate: { lte: dayStart }, endDate: { gte: dayStart } },
    select: { startDate: true, reason: true, endDate: true },
  });
  if (blackouts.length > 0) {
    return { available: false, reason: blackoutReason(blackouts[0]) };
  }

  // Collected so a refusal can name the real obstacle rather than "unavailable".
  const misses = emptyMisses();
  const scheduled = scheduledDepartures(schedules, q.date, misses);

  const overrides = scheduled.length === 0 ? [] : await prisma.listingDepartureOverride.findMany({
    where: { listingId: q.listingId, departsAt: { in: scheduled.map((d) => d.departsAt) } },
  });
  const overrideAt = new Map(overrides.map((o) => [o.departsAt.getTime(), o]));
  const busy = scheduled.length === 0
    ? { intervals: [], durationMinutes: null }
    : await busyFor(q.listingId, scheduled[0].departsAt, new Date(scheduled[scheduled.length - 1].departsAt.getTime() + DAY_MS));

  const options: DepartureOption[] = [];

  for (const d of scheduled) {
    const taken = await seatsTaken(q.listingId, d.departsAt, now);
    const state = evaluateDeparture(d, {
      taken, override: overrideAt.get(d.departsAt.getTime()), guests, now,
      busy: overlapsBusy(d.departsAt, busy.durationMinutes, busy.intervals),
    });
    if (state.block) { misses[state.block]++; continue; }
    options.push({
      scheduleId: state.scheduleId,
      departsAt: state.departsAt,
      localTime: state.localTime,
      seatsLeft: state.seatsLeft,
    });
  }

  if (options.length === 0) {
    return { available: false, reason: refusalReason(misses, guests, schedules) };
  }

  const quote = await quoteFor(q.listingId, guests, dayStart);
  return { available: true, departures: options, quote };
}

export type CalendarDay = {
  date: string;
  /** Why nothing runs, when nothing does. Null on a day with departures. */
  blackout: string | null;
  departures: DepartureState[];
};

/**
 * Every departure across a run of local dates, with what each has sold.
 *
 * This is the operator's calendar and the booking page's month view. It reads the
 * same rule as `resolveAvailability`, in four queries for the whole range rather
 * than per day, so a month costs the same as a morning.
 */
export async function listDepartures(input: {
  listingId: string;
  from: string;
  to: string;
  /**
   * The party to test each departure against. Left out, each departure is tested
   * against one guest, which is the question a calendar asks: "could anyone book this".
   */
  guests?: number;
  now?: Date;
  ignoreWindow?: boolean;
}): Promise<CalendarDay[]> {
  const now = input.now ?? new Date();
  const guests = input.guests === undefined ? undefined : Math.max(1, Math.floor(input.guests));
  const { start: fromStart } = dayBounds(input.from);
  const { end: toEnd } = dayBounds(input.to);
  // Local dates sit up to 14 hours either side of UTC; widen the instant window to match.
  const windowStart = new Date(fromStart.getTime() - DAY_MS);
  const windowEnd = new Date(toEnd.getTime() + DAY_MS);

  const [schedules, blackouts, overrides, holds, busy] = await Promise.all([
    prisma.listingSchedule.findMany({ where: { listingId: input.listingId, active: true } }),
    prisma.listingBlackout.findMany({
      where: { listingId: input.listingId, startDate: { lte: toEnd }, endDate: { gte: fromStart } },
      select: { startDate: true, endDate: true, reason: true },
    }),
    prisma.listingDepartureOverride.findMany({
      where: { listingId: input.listingId, departsAt: { gte: windowStart, lte: windowEnd } },
    }),
    prisma.listingSeatHold.findMany({
      where: { listingId: input.listingId, departsAt: { gte: windowStart, lte: windowEnd } },
      select: { departsAt: true, seats: true, confirmed: true, expiresAt: true },
    }),
    busyFor(input.listingId, windowStart, windowEnd),
  ]);

  const overrideAt = new Map(overrides.map((o) => [o.departsAt.getTime(), o]));
  const holdsAt = new Map<number, HoldRow[]>();
  for (const h of holds) {
    const key = h.departsAt.getTime();
    holdsAt.set(key, [...(holdsAt.get(key) ?? []), h]);
  }

  const days: CalendarDay[] = [];
  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    const b = blackoutOn(blackouts, date);
    if (b) {
      days.push({ date, blackout: b.reason ?? "Closed", departures: [] });
      continue;
    }
    const departures = scheduledDepartures(schedules, date).map((d) =>
      evaluateDeparture(d, {
        taken: countTaken(holdsAt.get(d.departsAt.getTime()) ?? [], now),
        override: overrideAt.get(d.departsAt.getTime()),
        guests: guests ?? 1,
        now,
        ignoreWindow: input.ignoreWindow,
        busy: overlapsBusy(d.departsAt, busy.durationMinutes, busy.intervals),
      }),
    );
    days.push({ date, blackout: null, departures });
  }
  return days;
}

/**
 * Turns the tally of why every departure was excluded into one sentence a
 * traveller can act on. Ordered by what the traveller can actually change: a
 * different day beats a different date beats a smaller party.
 */
export function refusalReason(
  misses: Misses,
  guests: number,
  schedules: { weekdays: number[]; minGuests: number; cutoffHours: number }[],
): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  if (misses.full > 0) {
    return guests > 1
      ? `That date is full for a party of ${guests}. Try another date, or ask about a smaller group.`
      : "That date is fully booked.";
  }
  if (misses.cutoff > 0) {
    const hours = Math.max(...schedules.map((s) => s.cutoffHours));
    return `Bookings close ${hours} hours before departure, so that one has already closed. The next available date will work.`;
  }
  if (misses.closed > 0) return "The operator is not running that departure. Another date will work.";
  if (misses.weekday > 0) {
    const days = [...new Set(schedules.flatMap((s) => s.weekdays))].sort().map((d) => names[d]);
    return days.length > 0
      ? `This trip does not run that day. It runs on ${days.join(", ")}.`
      : "This trip does not run on that day.";
  }
  if (misses.season > 0) return "That date falls outside the season this trip runs.";
  if (misses.advance > 0) return "That date is further ahead than bookings are open for.";
  return "No departures available on that date.";
}
