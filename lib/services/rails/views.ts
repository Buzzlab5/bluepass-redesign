import type { ListingBookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  addDays,
  listDepartures,
  localDateInZone,
  localTimeInZone,
  type DepartureState,
  type PricedLine,
} from "@/lib/services/operators/listing-availability";
import { expireLapsedBookings } from "@/lib/services/rails/bookings";
import { normaliseReference } from "@/lib/services/rails/reference";

/**
 * What the operator console reads. Every loader takes the operator's profile id and
 * filters by it in the query itself, so a page can only ever be handed that
 * operator's rows; there is no "load then check" step to forget.
 */

const ACTIVE: ListingBookingStatus[] = ["CONFIRMED", "REQUESTED", "PENDING_PAYMENT"];

export const DEFAULT_ZONE = "Australia/Brisbane";

/** The operator's own "today", read in the zone their first trip leaves from. */
export async function operatorToday(operatorProfileId: string, now = new Date()) {
  const schedule = await prisma.listingSchedule.findFirst({
    where: { active: true, listing: { operatorProfileId, status: "LIVE" } },
    select: { timezone: true },
    orderBy: { createdAt: "asc" },
  });
  // An operator selling only from Rezdy has no schedule here; their Rezdy account says where they are.
  const connection = schedule ? null : await prisma.operatorChannelConnection.findFirst({
    where: { operatorProfileId, timezone: { not: null } },
    select: { timezone: true },
  });
  const timezone = schedule?.timezone ?? connection?.timezone ?? DEFAULT_ZONE;
  return { today: localDateInZone(now, timezone), timezone };
}

/**
 * A departure on a trip whose seats live in the operator's own system. Bluepass knows
 * only its own bookings on it, so it has no capacity to show; a closure is the one
 * thing Bluepass itself can set.
 */
function channelDeparture(departsAt: Date, timezone: string, override?: { closed: boolean; note: string | null } | null): DepartureState {
  return {
    scheduleId: "",
    scheduleLabel: null,
    departsAt,
    localTime: localTimeInZone(departsAt, timezone),
    capacity: 0,
    ruleCapacity: 0,
    taken: 0,
    seatsLeft: 0,
    minGuests: 1,
    closed: override?.closed ?? false,
    busy: false,
    note: override?.note ?? null,
    block: null,
  };
}

export type CalendarItem = {
  listingId: string;
  title: string;
  status: string;
  /** Where the seats live. Only Bluepass's own trips have a capacity to fill. */
  channel: string;
  timezone: string;
  departure: DepartureState;
  bookedGuests: number;
  checkedIn: number;
  bookings: number;
  pendingGuests: number;
};

export type CalendarView = {
  days: { date: string; items: CalendarItem[]; closed: { title: string; reason: string }[] }[];
  hasSchedules: boolean;
};

export async function operatorCalendar(input: { operatorProfileId: string; from: string; to: string; now?: Date }): Promise<CalendarView> {
  const now = input.now ?? new Date();
  await expireLapsedBookings(now);

  const listings = await prisma.operatorListing.findMany({
    // Live trips only: a draft cannot be sold, so its departures are not departures yet.
    where: { operatorProfileId: input.operatorProfileId, status: "LIVE", schedules: { some: { active: true } } },
    select: { id: true, title: true, status: true, schedules: { where: { active: true }, select: { timezone: true }, take: 1 } },
    orderBy: { createdAt: "asc" },
  });

  const bookings = await prisma.listingBooking.findMany({
    where: {
      operatorProfileId: input.operatorProfileId,
      status: { in: ACTIVE },
      departsAt: { gte: new Date(Date.parse(`${input.from}T00:00:00Z`) - 86_400_000), lte: new Date(Date.parse(`${input.to}T23:59:59Z`) + 86_400_000) },
    },
    select: { listingId: true, departsAt: true, guests: true, status: true, checkedInAt: true, timezone: true, channel: true, listing: { select: { title: true, status: true } } },
  });
  const tally = new Map<string, { guests: number; checkedIn: number; bookings: number; pending: number }>();
  for (const b of bookings) {
    const key = `${b.listingId}|${b.departsAt.getTime()}`;
    const t = tally.get(key) ?? { guests: 0, checkedIn: 0, bookings: 0, pending: 0 };
    if (b.status === "PENDING_PAYMENT") t.pending += b.guests;
    else {
      t.guests += b.guests;
      t.bookings += 1;
      if (b.checkedInAt) t.checkedIn += b.guests;
    }
    tally.set(key, t);
  }

  const channelDepartures = new Map<string, { listingId: string; title: string; status: string; channel: string; timezone: string; departsAt: Date; date: string }>();
  for (const b of bookings) {
    if (b.channel === "NATIVE") continue;
    const key = `${b.listingId}|${b.departsAt.getTime()}`;
    const date = localDateInZone(b.departsAt, b.timezone);
    if (date < input.from || date > input.to) continue;
    channelDepartures.set(key, { listingId: b.listingId, title: b.listing.title, status: b.listing.status, channel: b.channel, timezone: b.timezone, departsAt: b.departsAt, date });
  }
  const overrides = new Map(
    channelDepartures.size
      ? (await prisma.listingDepartureOverride.findMany({
          where: { OR: [...channelDepartures.values()].map((d) => ({ listingId: d.listingId, departsAt: d.departsAt })) },
          select: { listingId: true, departsAt: true, closed: true, note: true },
        })).map((o): [string, { closed: boolean; note: string | null }] => [`${o.listingId}|${o.departsAt.getTime()}`, o])
      : [],
  );

  const perListing = await Promise.all(
    listings.map(async (l) => ({
      listing: l,
      days: await listDepartures({ listingId: l.id, from: input.from, to: input.to, now }),
    })),
  );

  const days: CalendarView["days"] = [];
  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    const items: CalendarItem[] = [];
    const closed: { title: string; reason: string }[] = [];
    for (const { listing, days: listingDays } of perListing) {
      const day = listingDays.find((d) => d.date === date);
      if (!day) continue;
      if (day.blackout) closed.push({ title: listing.title, reason: day.blackout });
      for (const departure of day.departures) {
        const t = tally.get(`${listing.id}|${departure.departsAt.getTime()}`);
        items.push({
          listingId: listing.id,
          title: listing.title,
          status: listing.status,
          channel: "NATIVE",
          timezone: listing.schedules[0]?.timezone ?? DEFAULT_ZONE,
          departure,
          bookedGuests: t?.guests ?? 0,
          checkedIn: t?.checkedIn ?? 0,
          bookings: t?.bookings ?? 0,
          pendingGuests: t?.pending ?? 0,
        });
      }
    }
    // Rezdy and other channel trips: the departures Bluepass has sold seats on.
    for (const [key, t] of channelDepartures) {
      if (t.date !== date) continue;
      const override = overrides.get(key);
      items.push({
        listingId: t.listingId,
        title: t.title,
        status: t.status,
        channel: t.channel,
        timezone: t.timezone,
        departure: channelDeparture(t.departsAt, t.timezone, override),
        bookedGuests: tally.get(key)?.guests ?? 0,
        checkedIn: tally.get(key)?.checkedIn ?? 0,
        bookings: tally.get(key)?.bookings ?? 0,
        pendingGuests: tally.get(key)?.pending ?? 0,
      });
    }
    items.sort((a, b) => a.departure.departsAt.getTime() - b.departure.departsAt.getTime());
    days.push({ date, items, closed });
  }
  const channelTrips = await prisma.operatorListing.count({
    where: { operatorProfileId: input.operatorProfileId, status: "LIVE", channel: { not: "NATIVE" } },
  });
  return { days, hasSchedules: listings.length > 0 || channelTrips > 0 || channelDepartures.size > 0 };
}

const manifestSelect = {
  id: true,
  reference: true,
  channel: true,
  externalReference: true,
  answers: true,
  status: true,
  source: true,
  paymentStatus: true,
  timezone: true,
  guests: true,
  lines: true,
  totalCents: true,
  currency: true,
  leadName: true,
  leadEmail: true,
  leadPhone: true,
  whatsappOptIn: true,
  notes: true,
  checkedInAt: true,
  cancelReason: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.ListingBookingSelect;

export type ManifestBooking = Omit<Prisma.ListingBookingGetPayload<{ select: typeof manifestSelect }>, "lines"> & {
  lines: PricedLine[];
};

export async function departureManifest(input: { operatorProfileId: string; listingId: string; departsAt: Date; now?: Date }) {
  const now = input.now ?? new Date();
  await expireLapsedBookings(now);

  const listing = await prisma.operatorListing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true, title: true, slug: true, operatorProfileId: true, meetingPoint: true, durationMinutes: true, currency: true, channel: true,
      schedules: { where: { active: true }, select: { timezone: true } },
    },
  });
  if (!listing || listing.operatorProfileId !== input.operatorProfileId) return null;

  const rows = await prisma.listingBooking.findMany({
    where: { listingId: listing.id, departsAt: input.departsAt, operatorProfileId: input.operatorProfileId },
    select: manifestSelect,
    orderBy: { createdAt: "asc" },
  });
  const bookings = rows.map((b) => ({ ...b, lines: b.lines as unknown as PricedLine[] }));

  // The departure's own state, read the same way the calendar reads it. A booked
  // departure is always found: setup refuses edits that would orphan one.
  const zone = rows[0]?.timezone ?? listing.schedules[0]?.timezone ?? DEFAULT_ZONE;
  const date = localDateInZone(input.departsAt, zone);
  let departure: DepartureState | null;
  let day: Awaited<ReturnType<typeof listDepartures>>[number] | undefined;
  if (listing.channel === "NATIVE") {
    [day] = await listDepartures({ listingId: listing.id, from: date, to: date, now, ignoreWindow: true });
    departure = day?.departures.find((d) => d.departsAt.getTime() === input.departsAt.getTime()) ?? null;
  } else {
    const override = await prisma.listingDepartureOverride.findUnique({
      where: { listingId_departsAt: { listingId: listing.id, departsAt: input.departsAt } },
      select: { closed: true, note: true },
    });
    departure = channelDeparture(input.departsAt, zone, override);
  }

  const onboard = bookings.filter((b) => b.status === "CONFIRMED" || b.status === "REQUESTED");
  const pending = bookings.filter((b) => b.status === "PENDING_PAYMENT");
  const cancelled = bookings.filter((b) => b.status === "CANCELLED");

  return {
    listing,
    timezone: zone,
    date,
    departure,
    blackout: day?.blackout ?? null,
    onboard,
    pending,
    cancelled,
    totals: {
      guests: onboard.reduce((n, b) => n + b.guests, 0),
      checkedIn: onboard.filter((b) => b.checkedInAt).reduce((n, b) => n + b.guests, 0),
      toCollectCents: onboard.filter((b) => b.paymentStatus === "UNPAID").reduce((n, b) => n + b.totalCents, 0),
    },
  };
}

export type BookingsFilter = "upcoming" | "past" | "cancelled";

export async function operatorBookings(input: { operatorProfileId: string; filter: BookingsFilter; q?: string; now?: Date; take?: number }) {
  const now = input.now ?? new Date();
  await expireLapsedBookings(now);
  const q = input.q?.trim();

  const where: Prisma.ListingBookingWhereInput = { operatorProfileId: input.operatorProfileId };
  if (input.filter === "upcoming") Object.assign(where, { status: { in: ACTIVE }, departsAt: { gte: new Date(now.getTime() - 12 * 3_600_000) } });
  if (input.filter === "past") Object.assign(where, { status: { in: ["CONFIRMED", "REQUESTED"] }, departsAt: { lt: new Date(now.getTime() - 12 * 3_600_000) } });
  if (input.filter === "cancelled") Object.assign(where, { status: { in: ["CANCELLED", "EXPIRED"] } });
  if (q) {
    where.OR = [
      { reference: { contains: normaliseReference(q).replace("BP-", ""), mode: "insensitive" } },
      { leadName: { contains: q, mode: "insensitive" } },
      { leadEmail: { contains: q, mode: "insensitive" } },
      { leadPhone: { contains: q.replace(/\s/g, "") } },
      { externalReference: { contains: q.trim(), mode: "insensitive" } },
    ];
  }

  const rows = await prisma.listingBooking.findMany({
    where,
    orderBy: [{ departsAt: input.filter === "upcoming" ? "asc" : "desc" }, { createdAt: "asc" }],
    take: input.take ?? 100,
    select: {
      id: true, reference: true, status: true, source: true, paymentStatus: true, departsAt: true, timezone: true,
      guests: true, totalCents: true, currency: true, leadName: true, leadPhone: true, checkedInAt: true, createdAt: true,
      channel: true, externalReference: true,
      listing: { select: { id: true, title: true } },
    },
  });
  const counts = await prisma.listingBooking.groupBy({
    by: ["status"],
    where: { operatorProfileId: input.operatorProfileId, departsAt: { gte: new Date(now.getTime() - 12 * 3_600_000) } },
    _count: true,
  });
  return { rows, upcomingCount: counts.filter((c) => ACTIVE.includes(c.status)).reduce((n, c) => n + c._count, 0) };
}

export async function bookingDetail(input: { operatorProfileId: string; reference: string }) {
  const booking = await prisma.listingBooking.findUnique({
    where: { reference: normaliseReference(input.reference) },
    include: {
      listing: { select: { id: true, title: true, slug: true, meetingPoint: true } },
      events: { orderBy: { createdAt: "asc" } },
      notifications: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!booking || booking.operatorProfileId !== input.operatorProfileId) return null;
  return { ...booking, lines: booking.lines as unknown as PricedLine[] };
}

/** The dashboard's one line: what is happening today and what Bluepass owes. */
export async function operatorRailsSummary(operatorProfileId: string, now = new Date()) {
  const { today, timezone } = await operatorToday(operatorProfileId, now);
  const calendar = await operatorCalendar({ operatorProfileId, from: today, to: addDays(today, 6), now });
  const todayItems = calendar.days[0]?.items ?? [];

  const owed = await prisma.listingBooking.groupBy({
    by: ["currency"],
    where: { operatorProfileId, status: "CONFIRMED", paymentStatus: "PAID", settledAt: null },
    _sum: { operatorNetCents: true },
  });

  return {
    hasSchedules: calendar.hasSchedules,
    timezone,
    today,
    todayDepartures: todayItems.length,
    todayGuests: todayItems.reduce((n, i) => n + i.bookedGuests, 0),
    weekGuests: calendar.days.reduce((n, d) => n + d.items.reduce((m, i) => m + i.bookedGuests, 0), 0),
    owed: owed.map((o) => ({ currency: o.currency, cents: o._sum.operatorNetCents ?? 0 })).filter((o) => o.cents > 0),
  };
}
