import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { departureEntries } from "@/lib/services/rails/calendar-events";
import { buildCalendar } from "@/lib/services/rails/ics";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/**
 * GET /api/rails/feed/<secret>.ics
 *
 * An operator's booked departures as a calendar any app can subscribe to by URL:
 * Apple Calendar, Outlook, or Google. The secret in the address is the only key, so
 * the operator can revoke a leaked link by making a new one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const token = file.replace(/\.ics$/i, "");
  if (token.length < 20) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const settings = await prisma.operatorRailsSettings.findUnique({
    where: { calendarFeedToken: token },
    select: { operatorProfileId: true, operatorProfile: { select: { companyName: true } } },
  });
  if (!settings) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const now = new Date();
  const entries = await departureEntries({
    operatorProfileId: settings.operatorProfileId,
    from: new Date(now.getTime() - 14 * DAY_MS),
    to: new Date(now.getTime() + 365 * DAY_MS),
  });
  const body = buildCalendar({
    name: `${settings.operatorProfile.companyName ?? "Bluepass"} bookings`,
    refreshMinutes: 15,
    now,
    events: entries.map((e) => ({
      uid: e.uid,
      startsAt: e.departsAt,
      endsAt: e.endsAt,
      summary: e.title,
      location: e.location,
      description: e.description,
      url: e.manifestUrl,
    })),
  });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
    },
  });
}
