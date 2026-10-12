import { NextResponse } from "next/server";
import { listLiveAffiliateTripsForKai } from "@/lib/services/discover/affiliate-trips";

export const revalidate = 300;

// Public, read-only, like /api/kai/catalog-snapshot: the live trips BluePass resells as a
// FareHarbor affiliate or Rezdy agent, with the booking link Kai hands to travellers. Nothing here
// is private - it is the same information the trips page already shows.
export async function GET() {
  const trips = await listLiveAffiliateTripsForKai();

  return NextResponse.json({ trips });
}
