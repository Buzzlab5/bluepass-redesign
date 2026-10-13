import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { bookingCalendarResponse } from "@/lib/services/rails/booking-calendar-file";

export const dynamic = "force-dynamic";

/**
 * GET /api/rails/calendar-file?session_id=cs_...
 *
 * The booked departure as an .ics file, from the post-payment page. Keyed on the
 * checkout id, which only the paying browser was given.
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id is required." }, { status: 400 });

  const b = await prisma.listingBooking.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
    include: { listing: { select: { title: true, meetingPoint: true, durationMinutes: true, confirmationNote: true } } },
  });
  if (!b || b.status !== "CONFIRMED") return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  return bookingCalendarResponse(b, b.listing);
}
