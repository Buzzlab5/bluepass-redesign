import { NextResponse } from "next/server";
import { RezdyError } from "@/lib/services/channels/rezdy/api";
import { bookableTrip, tripMonth } from "@/lib/services/channels/trips";

export const dynamic = "force-dynamic";

/**
 * GET /api/rails/:slug/calendar?month=2026-11
 *
 * One month of bookable days, whichever system holds the trip's seats: Bluepass's own
 * calendar, or the operator's Rezdy read live. Public: it is the same information the
 * booking page shows anyone, and the same an agent needs to answer "what dates are
 * free in November". A FareHarbor trip has no calendar here; its answer is the link
 * to the operator's own checkout.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "month must look like 2026-11." }, { status: 400 });
  }
  const trip = await bookableTrip(slug);
  if (!trip) return NextResponse.json({ error: "This trip is not taking bookings." }, { status: 404 });
  if (trip.kind === "fareharbor") {
    return NextResponse.json({ error: "This trip books on the operator's FareHarbor checkout.", code: "EXTERNAL_CHECKOUT", channel: "FAREHARBOR" }, { status: 409 });
  }
  try {
    return NextResponse.json({ ...(await tripMonth(trip, month)), channel: trip.kind === "rezdy" ? "REZDY" : "NATIVE" });
  } catch (error) {
    if (error instanceof RezdyError) return NextResponse.json({ error: "The operator's booking system did not answer. Try again in a minute." }, { status: 503 });
    throw error;
  }
}
