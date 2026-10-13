import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { bookingCalendarResponse } from "@/lib/services/rails/booking-calendar-file";

export const dynamic = "force-dynamic";

/** GET /trip/<token>/calendar.ics: the guest's booking for Apple Calendar or Outlook. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await prisma.listingBooking.findUnique({
    where: { guestToken: token },
    include: { listing: { select: { title: true, meetingPoint: true, durationMinutes: true, confirmationNote: true } } },
  });
  if (!b || b.status !== "CONFIRMED") return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  return bookingCalendarResponse(b, b.listing);
}
