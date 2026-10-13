import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { PricedLine } from "@/lib/services/operators/listing-availability";
import { formatClock } from "@/lib/services/rails/format";
import { partyText } from "@/lib/services/rails/labels";
import { formatMoney } from "@/lib/services/rails/money";

/**
 * A departure as it appears in an operator's own calendar: one event per departure,
 * not one per booking, with the manifest in its notes. Twelve events stacked at 8am
 * would tell a skipper less than one that says "10 of 14" and lists who is coming.
 *
 * Built once here and read by both the Google sync and the subscribe-by-URL feed, so
 * Google Calendar, Apple Calendar and Outlook all show the operator the same thing.
 * Guest names and numbers are included on purpose: the crew reading this calendar on
 * the jetty is who they are for, and it is the operator's own calendar.
 */

export type DepartureCalendarEntry = {
  listingId: string;
  departsAt: Date;
  endsAt: Date;
  timezone: string;
  title: string;
  location: string | null;
  description: string;
  manifestUrl: string;
  /** Stable across every sync and feed fetch, and valid as a Google event id. */
  uid: string;
};

/** A trip with no stated length shows as two hours, long enough to read in a day view. */
const DEFAULT_EVENT_MINUTES = 120;

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.BLUEPASS_APP_URL || "https://bluepass.co").replace(/\/$/, "");
}

export function manifestPath(listingId: string, departsAt: Date) {
  return `/operator/departures/${listingId}/${departsAt.getTime()}`;
}

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/**
 * Google event ids may only use 0-9 and a-v. Deriving the id from the departure,
 * rather than storing whatever Google hands back, makes every write idempotent: two
 * syncs racing for the same departure update one event instead of creating two.
 */
export function calendarEventId(listingId: string, departsAt: Date): string {
  const digest = createHash("sha256").update(`${listingId}|${departsAt.toISOString()}`).digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 30) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `bp${out}`;
}

/**
 * Records that a departure's bookings changed, so the operator's Google Calendar is
 * brought up to date. A database write only; the call to Google happens after the
 * response, or on the next scheduled sync if that is missed. Does nothing for an
 * operator who has not connected Google.
 */
export async function markDepartureChanged(operatorProfileId: string, listingId: string, departsAt: Date) {
  const connection = await prisma.operatorGoogleConnection.findUnique({
    where: { operatorProfileId },
    select: { id: true },
  });
  if (!connection) return;
  const now = new Date();
  await prisma.departureCalendarEvent.upsert({
    where: { listingId_departsAt: { listingId, departsAt } },
    create: { listingId, departsAt, dirtyAt: now },
    update: { dirtyAt: now },
  });
}

/**
 * Calendar entries for an operator's booked departures: every one in a window, or a
 * single departure when `listingId` and `departsAt` are given. A departure with no
 * confirmed booking has no entry, which is what tells the sync to remove its event.
 */
export async function departureEntries(input: {
  operatorProfileId: string;
  from?: Date;
  to?: Date;
  listingId?: string;
  departsAt?: Date;
}): Promise<DepartureCalendarEntry[]> {
  const bookings = await prisma.listingBooking.findMany({
    where: {
      operatorProfileId: input.operatorProfileId,
      status: "CONFIRMED",
      ...(input.listingId ? { listingId: input.listingId } : {}),
      departsAt: input.departsAt ?? { gte: input.from, lte: input.to },
    },
    orderBy: [{ departsAt: "asc" }, { createdAt: "asc" }],
    select: {
      listingId: true, departsAt: true, timezone: true, scheduleId: true, guests: true, lines: true,
      leadName: true, leadPhone: true, notes: true, paymentStatus: true, totalCents: true, currency: true,
      listing: { select: { title: true, meetingPoint: true, durationMinutes: true } },
    },
  });
  if (bookings.length === 0) return [];

  const scheduleIds = [...new Set(bookings.map((b) => b.scheduleId).filter((id): id is string => Boolean(id)))];
  const [schedules, overrides] = await Promise.all([
    prisma.listingSchedule.findMany({ where: { id: { in: scheduleIds } }, select: { id: true, capacityPerDeparture: true } }),
    prisma.listingDepartureOverride.findMany({
      where: {
        listingId: { in: [...new Set(bookings.map((b) => b.listingId))] },
        departsAt: { gte: bookings[0].departsAt, lte: bookings[bookings.length - 1].departsAt },
      },
      select: { listingId: true, departsAt: true, capacity: true },
    }),
  ]);
  const capacityOf = new Map(schedules.map((s) => [s.id, s.capacityPerDeparture]));
  const overrideOf = new Map(overrides.map((o) => [`${o.listingId}|${o.departsAt.getTime()}`, o.capacity]));

  const groups = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const key = `${b.listingId}|${b.departsAt.getTime()}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }

  const entries: DepartureCalendarEntry[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    const guests = group.reduce((n, b) => n + b.guests, 0);
    const capacity = overrideOf.get(key) ?? (first.scheduleId ? capacityOf.get(first.scheduleId) : undefined);
    const minutes = first.listing.durationMinutes ?? DEFAULT_EVENT_MINUTES;
    const manifestUrl = `${siteUrl()}${manifestPath(first.listingId, first.departsAt)}`;

    const lines = group.map((b) => {
      const parts = [b.leadName, partyText(b.lines as unknown as PricedLine[], b.guests)];
      if (b.leadPhone) parts.push(b.leadPhone);
      if (b.paymentStatus === "UNPAID" && b.totalCents > 0) parts.push(`to collect ${formatMoney(b.totalCents, b.currency)}`);
      if (b.notes) parts.push(`"${b.notes}"`);
      return parts.join(" · ");
    });

    const booked = capacity ? `${guests} of ${capacity} booked` : `${guests} booked`;
    entries.push({
      listingId: first.listingId,
      departsAt: first.departsAt,
      endsAt: new Date(first.departsAt.getTime() + minutes * 60_000),
      timezone: first.timezone,
      title: `${first.listing.title} · ${capacity ? `${guests} of ${capacity}` : `${guests} guests`}`,
      location: first.listing.meetingPoint,
      description: [
        `${booked}, departing ${formatClock(first.departsAt, first.timezone)}.`,
        "",
        ...lines,
        "",
        `Manifest and check-in: ${manifestUrl}`,
        "Kept up to date by Bluepass. Changes made here are overwritten.",
      ].join("\n"),
      manifestUrl,
      uid: calendarEventId(first.listingId, first.departsAt),
    });
  }
  return entries;
}
