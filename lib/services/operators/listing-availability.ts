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

function dayBounds(date: string): { start: Date; end: Date } {
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

/** Seats already taken on a departure: confirmed seats plus holds that have not expired. */
export async function seatsTaken(listingId: string, departsAt: Date, now: Date): Promise<number> {
  const holds = await prisma.listingSeatHold.findMany({
    where: { listingId, departsAt },
    select: { seats: true, confirmed: true, expiresAt: true },
  });
  return holds
    .filter((h) => h.confirmed || !h.expiresAt || h.expiresAt > now)
    .reduce((n, h) => n + h.seats, 0);
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
    select: { reason: true, endDate: true },
  });
  if (blackouts.length > 0) {
    const b = blackouts[0];
    return {
      available: false,
      reason: b.reason
        ? `Not running on that date: ${b.reason}. Back on ${formatDate(new Date(b.endDate.getTime() + DAY_MS))}.`
        : `Not running on that date. Back on ${formatDate(new Date(b.endDate.getTime() + DAY_MS))}.`,
    };
  }

  const options: DepartureOption[] = [];
  // Collected so a refusal can name the real obstacle rather than "unavailable".
  const misses = { season: 0, weekday: 0, cutoff: 0, advance: 0, full: 0, tooFew: 0 };

  for (const s of schedules) {
    if (!inSeason(dayStart, s.seasonStart, s.seasonEnd)) { misses.season++; continue; }

    const wd = weekdayInZone(q.date, s.timezone);
    if (s.weekdays.length > 0 && !s.weekdays.includes(wd)) { misses.weekday++; continue; }

    if (guests < s.minGuests) { misses.tooFew++; continue; }

    for (const time of s.departureTimes) {
      const departsAt = zonedTimeToUtc(q.date, time, s.timezone);

      if (departsAt.getTime() - now.getTime() > s.maxAdvanceDays * DAY_MS) {
        misses.advance++; continue;
      }
      if (departsAt.getTime() - now.getTime() < s.cutoffHours * 3_600_000) {
        misses.cutoff++; continue;
      }

      const taken = await seatsTaken(q.listingId, departsAt, now);
      const seatsLeft = s.capacityPerDeparture - taken;
      if (seatsLeft < guests) { misses.full++; continue; }

      options.push({ scheduleId: s.id, departsAt, localTime: time, seatsLeft });
    }
  }

  if (options.length === 0) {
    return { available: false, reason: refusalReason(misses, guests, schedules) };
  }

  options.sort((a, b) => a.departsAt.getTime() - b.departsAt.getTime());
  const quote = await quoteFor(q.listingId, guests, dayStart);
  return { available: true, departures: options, quote };
}

/**
 * Turns the tally of why every departure was excluded into one sentence a
 * traveller can act on. Ordered by what the traveller can actually change: a
 * different day beats a different date beats a smaller party.
 */
function refusalReason(
  misses: { season: number; weekday: number; cutoff: number; advance: number; full: number; tooFew: number },
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
  if (misses.weekday > 0) {
    const days = [...new Set(schedules.flatMap((s) => s.weekdays))].sort().map((d) => names[d]);
    return days.length > 0
      ? `This trip does not run that day. It runs on ${days.join(", ")}.`
      : "This trip does not run on that day.";
  }
  if (misses.season > 0) return "That date falls outside the season this trip runs.";
  if (misses.tooFew > 0) {
    const min = Math.min(...schedules.map((s) => s.minGuests));
    return `This trip needs at least ${min} guests to run.`;
  }
  if (misses.advance > 0) return "That date is further ahead than bookings are open for.";
  return "No departures available on that date.";
}
