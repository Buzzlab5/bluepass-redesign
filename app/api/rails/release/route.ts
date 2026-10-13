import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { expireCheckout } from "@/lib/services/rails/bookings";
import { railsPayments } from "@/lib/services/rails/payments";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ bookingId: z.string().min(10).max(40) });

/**
 * POST /api/rails/release
 *
 * The traveller changed their mind on the review step. Their seats go back now
 * rather than in half an hour, so the boat does not look fuller than it is to the
 * next person. Keyed on the booking's internal id, which only the browser that made
 * the reservation was given, and only ever ends an unpaid booking.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bookingId is required." }, { status: 400 });

  const booking = await prisma.listingBooking.findUnique({
    where: { id: parsed.data.bookingId },
    select: { id: true, status: true, stripeCheckoutSessionId: true },
  });
  if (booking?.status === "PENDING_PAYMENT") {
    const payments = railsPayments();
    if (payments && booking.stripeCheckoutSessionId) await payments.expireCheckout(booking.stripeCheckoutSessionId);
    await expireCheckout(booking.id);
  }
  return NextResponse.json({ released: true });
}
