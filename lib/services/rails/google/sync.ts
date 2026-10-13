import { prisma } from "@/lib/db/prisma";
import { decryptCredentials, encryptCredentials } from "@/lib/services/booking/adapters/credentials";
import type { BusyInterval } from "@/lib/services/operators/listing-availability";
import { calendarEventId, departureEntries, type DepartureCalendarEntry } from "@/lib/services/rails/calendar-events";
import {
  GoogleApiError,
  type GoogleCalendarApi,
  type GoogleCalendarSummary,
  type GoogleEventBody,
} from "@/lib/services/rails/google/api";

/**
 * Keeps an operator's Google Calendar in step with their departures, and their own
 * busy time in step with what Bluepass will sell.
 *
 * Writes go one way only: Bluepass owns the "Bluepass bookings" calendar it creates,
 * and an edit made there is overwritten on the next change. Reads go the other way:
 * the operator's chosen calendar is read for busy times, never for content.
 *
 * Every failure is either the operator's to fix (access revoked, which marks the
 * connection NEEDS_RECONNECT and stops trying) or nobody's (Google was slow, which
 * leaves the departure marked changed so the next run picks it up).
 */

export const BOOKINGS_CALENDAR_NAME = "Bluepass bookings";
/** How far ahead busy time is read. Further than most trips are booked, short of a year of queries. */
const BUSY_HORIZON_DAYS = 180;
/** FreeBusy is asked in slices this long; Google documents no range limit, so this stays modest. */
const BUSY_CHUNK_DAYS = 60;
const DAY_MS = 86_400_000;

type Tokens = { refreshToken: string };

export async function saveConnection(input: {
  operatorProfileId: string;
  refreshToken: string;
  googleEmail: string;
  scopes: string[];
  now?: Date;
}) {
  const encryptedTokens = encryptCredentials<Tokens>({ refreshToken: input.refreshToken });
  await prisma.operatorGoogleConnection.upsert({
    where: { operatorProfileId: input.operatorProfileId },
    create: {
      operatorProfileId: input.operatorProfileId,
      googleEmail: input.googleEmail,
      encryptedTokens,
      scopes: input.scopes,
    },
    update: { googleEmail: input.googleEmail, encryptedTokens, scopes: input.scopes, status: "CONNECTED", lastError: null },
  });
  await markAllUpcomingChanged(input.operatorProfileId, input.now);
}

/** Queues every upcoming booked departure, so a fresh connection shows what is already sold. */
export async function markAllUpcomingChanged(operatorProfileId: string, now = new Date()) {
  const departures = await prisma.listingBooking.groupBy({
    by: ["listingId", "departsAt"],
    where: { operatorProfileId, status: "CONFIRMED", departsAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  for (const d of departures) {
    await prisma.departureCalendarEvent.upsert({
      where: { listingId_departsAt: { listingId: d.listingId, departsAt: d.departsAt } },
      create: { listingId: d.listingId, departsAt: d.departsAt, dirtyAt: now },
      update: { dirtyAt: now },
    });
  }
  return departures.length;
}

async function markNeedsReconnect(operatorProfileId: string, error: unknown) {
  await prisma.operatorGoogleConnection.update({
    where: { operatorProfileId },
    data: {
      status: "NEEDS_RECONNECT",
      lastError: error instanceof Error ? error.message.slice(0, 300) : "Google stopped accepting the connection.",
    },
  });
}

/**
 * A working access token, or null once the connection is marked for the operator to
 * reconnect. Only Google saying no marks it: an unreachable Google or a timeout is
 * thrown as it is, because a network blip should cost a retry, not a phone call to
 * the operator asking them to sign in again.
 */
async function accessFor(operatorProfileId: string, api: GoogleCalendarApi) {
  const connection = await prisma.operatorGoogleConnection.findUnique({ where: { operatorProfileId } });
  if (!connection || connection.status !== "CONNECTED") return null;
  let refreshToken: string;
  try {
    ({ refreshToken } = decryptCredentials<Tokens>(connection.encryptedTokens));
  } catch {
    await markNeedsReconnect(operatorProfileId, new Error("The stored Google access could not be read. Reconnect to restore it."));
    return null;
  }
  try {
    return { connection, token: await api.accessToken(refreshToken) };
  } catch (error) {
    if (error instanceof GoogleApiError && error.needsReconnect) {
      await markNeedsReconnect(operatorProfileId, error);
      return null;
    }
    throw error;
  }
}

/**
 * The "Bluepass bookings" calendar, creating it the first time and again if the
 * operator deleted it. A recreated calendar is empty, so every upcoming departure is
 * queued to be written into it again.
 */
async function ensureBookingsCalendar(
  connection: { id: string; operatorProfileId: string; bookingsCalendarId: string | null },
  token: string,
  api: GoogleCalendarApi,
  now: Date,
): Promise<string> {
  if (connection.bookingsCalendarId && (await api.calendarExists(token, connection.bookingsCalendarId))) {
    return connection.bookingsCalendarId;
  }
  const schedule = await prisma.listingSchedule.findFirst({
    where: { active: true, listing: { operatorProfileId: connection.operatorProfileId } },
    select: { timezone: true },
  });
  const calendarId = await api.createCalendar(token, {
    summary: BOOKINGS_CALENDAR_NAME,
    description: "Departures booked through Bluepass, with who is coming. Updated automatically; changes made here are overwritten.",
    timeZone: schedule?.timezone ?? "Australia/Brisbane",
  });
  await prisma.operatorGoogleConnection.update({ where: { id: connection.id }, data: { bookingsCalendarId: calendarId } });
  if (connection.bookingsCalendarId) {
    await prisma.departureCalendarEvent.updateMany({
      where: { listing: { operatorProfileId: connection.operatorProfileId } },
      data: { googleEventId: null },
    });
  }
  await markAllUpcomingChanged(connection.operatorProfileId, now);
  return calendarId;
}

export function toGoogleEvent(entry: DepartureCalendarEntry): GoogleEventBody {
  return {
    summary: entry.title,
    description: entry.description,
    ...(entry.location ? { location: entry.location } : {}),
    start: { dateTime: entry.departsAt.toISOString(), timeZone: entry.timezone },
    end: { dateTime: entry.endsAt.toISOString(), timeZone: entry.timezone },
    status: "confirmed",
    source: { title: "Bluepass manifest", url: entry.manifestUrl },
    extendedProperties: { private: { bluepassListingId: entry.listingId, bluepassDepartsAt: entry.departsAt.toISOString() } },
  };
}

export type CalendarSyncResult = {
  status: "synced" | "not_connected" | "needs_reconnect";
  written: number;
  removed: number;
  failed: number;
};

/**
 * Writes every changed departure of one operator to their Google Calendar. A change
 * that lands while this runs keeps its departure marked, so nothing is lost to the
 * race between a booking and a sync already in flight.
 */
export async function syncOperatorCalendar(
  operatorProfileId: string,
  opts: { api: GoogleCalendarApi; now?: Date; limit?: number },
): Promise<CalendarSyncResult> {
  const now = opts.now ?? new Date();
  const result: CalendarSyncResult = { status: "synced", written: 0, removed: 0, failed: 0 };

  const access = await accessFor(operatorProfileId, opts.api);
  if (!access) {
    const exists = await prisma.operatorGoogleConnection.count({ where: { operatorProfileId } });
    return { ...result, status: exists ? "needs_reconnect" : "not_connected" };
  }

  try {
    const calendarId = await ensureBookingsCalendar(access.connection, access.token, opts.api, now);
    const changed = await prisma.departureCalendarEvent.findMany({
      where: { dirtyAt: { not: null }, listing: { operatorProfileId } },
      orderBy: { dirtyAt: "asc" },
      take: opts.limit ?? 100,
    });

    for (const row of changed) {
      try {
        const [entry] = await departureEntries({ operatorProfileId, listingId: row.listingId, departsAt: row.departsAt });
        const eventId = calendarEventId(row.listingId, row.departsAt);
        if (entry) {
          await opts.api.putEvent(access.token, calendarId, eventId, toGoogleEvent(entry));
          result.written += 1;
        } else if (row.googleEventId) {
          await opts.api.deleteEvent(access.token, calendarId, row.googleEventId);
          result.removed += 1;
        }
        // Cleared only if nothing changed while Google was being written to.
        await prisma.departureCalendarEvent.updateMany({
          where: { id: row.id, dirtyAt: row.dirtyAt },
          data: { dirtyAt: null, syncedAt: now, attempts: 0, lastError: null, googleEventId: entry ? eventId : null },
        });
      } catch (error) {
        if (error instanceof GoogleApiError && error.needsReconnect) throw error;
        result.failed += 1;
        await prisma.departureCalendarEvent.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0, 300) : "Sync failed" },
        });
      }
    }

    await prisma.operatorGoogleConnection.update({
      where: { operatorProfileId },
      data: { lastSyncedAt: now, lastError: result.failed > 0 ? "Some departures could not be written; they will be retried." : null },
    });
    return result;
  } catch (error) {
    if (error instanceof GoogleApiError && error.needsReconnect) {
      await markNeedsReconnect(operatorProfileId, error);
      return { ...result, status: "needs_reconnect" };
    }
    throw error;
  }
}

/**
 * Reads the operator's busy time from every calendar one of their trips is pointed
 * at, and replaces what was stored. Replaced rather than merged, so a charter the
 * operator deletes from their diary reopens the departure on the next run.
 */
export async function refreshBusyBlocks(
  operatorProfileId: string,
  opts: { api: GoogleCalendarApi; now?: Date },
): Promise<{ calendars: number; blocks: number; errors: string[] }> {
  const now = opts.now ?? new Date();
  const listings = await prisma.operatorListing.findMany({
    where: { operatorProfileId, busyCalendarId: { not: null } },
    select: { busyCalendarId: true },
  });
  const calendarIds = [...new Set(listings.map((l) => l.busyCalendarId as string))];

  // Calendars no trip points at any more stop closing anything.
  await prisma.operatorBusyBlock.deleteMany({ where: { operatorProfileId, calendarId: { notIn: calendarIds } } });
  if (calendarIds.length === 0) return { calendars: 0, blocks: 0, errors: [] };

  const access = await accessFor(operatorProfileId, opts.api);
  if (!access) return { calendars: calendarIds.length, blocks: 0, errors: ["Google needs reconnecting"] };

  const busy = new Map<string, BusyInterval[]>(calendarIds.map((id) => [id, []]));
  const failedCalendars = new Set<string>();
  const errors: string[] = [];
  try {
    for (let start = now.getTime(); start < now.getTime() + BUSY_HORIZON_DAYS * DAY_MS; start += BUSY_CHUNK_DAYS * DAY_MS) {
      const slice = await opts.api.freeBusy(access.token, calendarIds, new Date(start), new Date(start + BUSY_CHUNK_DAYS * DAY_MS));
      for (const id of calendarIds) {
        if (slice[id]?.error) {
          failedCalendars.add(id);
          errors.push(`${id}: ${slice[id].error}`);
        } else {
          busy.get(id)!.push(...(slice[id]?.busy ?? []));
        }
      }
    }
  } catch (error) {
    if (error instanceof GoogleApiError && error.needsReconnect) {
      await markNeedsReconnect(operatorProfileId, error);
      return { calendars: calendarIds.length, blocks: 0, errors: ["Google needs reconnecting"] };
    }
    throw error;
  }

  // A calendar Google could not read keeps its last known busy time rather than
  // suddenly reading as free and selling seats on a boat that is out on charter.
  const replace = calendarIds.filter((id) => !failedCalendars.has(id));
  const rows = replace.flatMap((calendarId) =>
    busy.get(calendarId)!.map((b) => ({ operatorProfileId, calendarId, startsAt: b.startsAt, endsAt: b.endsAt, syncedAt: now })),
  );
  await prisma.$transaction([
    prisma.operatorBusyBlock.deleteMany({ where: { operatorProfileId, calendarId: { in: replace } } }),
    prisma.operatorBusyBlock.createMany({ data: rows }),
  ]);
  return { calendars: calendarIds.length, blocks: rows.length, errors };
}

/**
 * A live look at the operator's calendar for one departure, made just before seats
 * are held. The scheduled refresh keeps busy time a quarter of an hour fresh at
 * worst; this closes that gap for the moment money is about to be taken.
 *
 * Returns null when it could not ask (no calendar chosen, not connected, Google down),
 * in which case the stored busy time still applies.
 */
export async function liveBusyCheck(
  listingId: string,
  departsAt: Date,
  opts: { api: GoogleCalendarApi },
): Promise<boolean | null> {
  const listing = await prisma.operatorListing.findUnique({
    where: { id: listingId },
    select: { busyCalendarId: true, durationMinutes: true, operatorProfileId: true },
  });
  if (!listing?.busyCalendarId) return null;
  try {
    const access = await accessFor(listing.operatorProfileId, opts.api);
    if (!access) return null;
    const end = new Date(departsAt.getTime() + Math.max(1, listing.durationMinutes ?? 60) * 60_000);
    const answer = (await opts.api.freeBusy(access.token, [listing.busyCalendarId], departsAt, end))[listing.busyCalendarId];
    if (!answer || answer.error) return null;
    await prisma.$transaction([
      prisma.operatorBusyBlock.deleteMany({
        where: { operatorProfileId: listing.operatorProfileId, calendarId: listing.busyCalendarId, startsAt: { lt: end }, endsAt: { gt: departsAt } },
      }),
      prisma.operatorBusyBlock.createMany({
        data: answer.busy.map((b) => ({
          operatorProfileId: listing.operatorProfileId,
          calendarId: listing.busyCalendarId as string,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
        })),
      }),
    ]);
    return answer.busy.length > 0;
  } catch {
    return null;
  }
}

/** The operator's calendars they can choose as a busy source, without Bluepass's own. */
export async function operatorCalendars(operatorProfileId: string, api: GoogleCalendarApi): Promise<GoogleCalendarSummary[] | null> {
  const access = await accessFor(operatorProfileId, api);
  if (!access) return null;
  const calendars = await api.listCalendars(access.token);
  return calendars
    .filter((c) => c.id !== access.connection.bookingsCalendarId)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary));
}

/**
 * Disconnects Google: removes the Bluepass calendar from their account (it would only
 * go stale), revokes access, and stops their calendar closing departures. Their own
 * calendars are untouched; Bluepass never had write access to them.
 */
export async function disconnectGoogle(operatorProfileId: string, api: GoogleCalendarApi | null) {
  const connection = await prisma.operatorGoogleConnection.findUnique({ where: { operatorProfileId } });
  if (!connection) return;
  if (api) {
    try {
      const { refreshToken } = decryptCredentials<Tokens>(connection.encryptedTokens);
      if (connection.bookingsCalendarId && connection.status === "CONNECTED") {
        const token = await api.accessToken(refreshToken);
        await api.deleteCalendar(token, connection.bookingsCalendarId);
      }
      await api.revoke(refreshToken);
    } catch {
      // Best effort: the operator can also remove access from their Google account.
    }
  }
  await prisma.$transaction([
    prisma.departureCalendarEvent.deleteMany({ where: { listing: { operatorProfileId } } }),
    prisma.operatorBusyBlock.deleteMany({ where: { operatorProfileId } }),
    prisma.operatorListing.updateMany({ where: { operatorProfileId }, data: { busyCalendarId: null } }),
    prisma.operatorGoogleConnection.delete({ where: { operatorProfileId } }),
  ]);
}

/** The scheduled run: every connected operator's changed departures, then their busy time. */
export async function runCalendarSync(opts: { api: GoogleCalendarApi; now?: Date }) {
  const connections = await prisma.operatorGoogleConnection.findMany({
    where: { status: "CONNECTED" },
    select: { operatorProfileId: true },
  });
  const summary = { operators: connections.length, written: 0, removed: 0, failed: 0, reconnect: 0, busyBlocks: 0 };
  for (const { operatorProfileId } of connections) {
    try {
      const r = await syncOperatorCalendar(operatorProfileId, opts);
      summary.written += r.written;
      summary.removed += r.removed;
      summary.failed += r.failed;
      if (r.status === "needs_reconnect") { summary.reconnect += 1; continue; }
      summary.busyBlocks += (await refreshBusyBlocks(operatorProfileId, opts)).blocks;
    } catch (error) {
      summary.failed += 1;
      console.warn("rails.calendar_sync_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}
