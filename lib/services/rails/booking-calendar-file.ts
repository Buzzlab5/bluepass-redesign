import { NextResponse } from "next/server";
import type { ListingBooking } from "@prisma/client";
import { buildCalendar } from "@/lib/services/rails/ics";
import { tripUrl } from "@/lib/services/rails/links";

/** One confirmed booking as a calendar file the traveller saves into their own calendar. */
export function bookingCalendarResponse(
  b: Pick<ListingBooking, "reference" | "departsAt" | "guests" | "guestToken">,
  listing: { title: string; meetingPoint: string | null; durationMinutes: number | null; confirmationNote: string | null },
) {
  const endsAt = new Date(b.departsAt.getTime() + (listing.durationMinutes ?? 180) * 60_000);
  const body = buildCalendar({
    events: [{
      uid: b.reference,
      startsAt: b.departsAt,
      endsAt,
      summary: listing.title,
      location: listing.meetingPoint,
      description: [`Booking ${b.reference}`, `${b.guests} ${b.guests === 1 ? "guest" : "guests"}`, listing.confirmationNote]
        .filter(Boolean)
        .join("\n\n"),
      url: b.guestToken ? tripUrl(b.guestToken) : null,
    }],
  });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${b.reference}.ics"`,
    },
  });
}
