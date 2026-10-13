import { NextResponse } from "next/server";
import { RezdyError } from "@/lib/services/channels/rezdy/api";
import { bookableTrip, tripDay } from "@/lib/services/channels/trips";

export const dynamic = "force-dynamic";

/**
 * GET /api/rails/:slug/departures?date=2026-11-12&guests=2
 *
 * The departures on one date for a party of that size (or, without guests, for the
 * smallest party each would run for), each with seats left and, when it cannot be
 * booked, why. Plus the prices on offer. A Rezdy trip prices each departure on its
 * own, so its departures carry their own prices.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const search = new URL(request.url).searchParams;
  const date = search.get("date") ?? "";
  const rawGuests = search.get("guests");
  const guests = rawGuests === null ? undefined : Number(rawGuests);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date must look like 2026-11-12." }, { status: 400 });
  if (guests !== undefined && (!Number.isInteger(guests) || guests < 1 || guests > 500)) {
    return NextResponse.json({ error: "guests must be a whole number." }, { status: 400 });
  }

  const trip = await bookableTrip(slug);
  if (!trip) return NextResponse.json({ error: "This trip is not taking bookings." }, { status: 404 });
  if (trip.kind === "fareharbor") {
    return NextResponse.json({ error: "This trip books on the operator's FareHarbor checkout.", code: "EXTERNAL_CHECKOUT", channel: "FAREHARBOR" }, { status: 409 });
  }
  try {
    return NextResponse.json(await tripDay(trip, date, guests));
  } catch (error) {
    if (error instanceof RezdyError) return NextResponse.json({ error: "The operator's booking system did not answer. Try again in a minute." }, { status: 503 });
    throw error;
  }
}
