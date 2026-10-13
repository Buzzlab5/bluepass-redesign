import { NextResponse } from "next/server";
import type { BookableTrip } from "@/lib/services/channels/trips";
import { prisma } from "@/lib/db/prisma";
import { recordHandoff } from "@/lib/services/channels/fareharbor/connect";
import { bookableTrip } from "@/lib/services/channels/trips";
import { getReferralAttributionFromCookies } from "@/lib/services/referrals/attribution";

export const dynamic = "force-dynamic";

async function handOff(slug: string) {
  const trip: BookableTrip | null = await bookableTrip(slug);
  if (!trip || trip.kind !== "fareharbor") return null;
  const listing = await prisma.operatorListing.findUniqueOrThrow({
    where: { id: trip.listing.id },
    select: { id: true, operatorProfileId: true, channelData: true, externalBookingUrl: true },
  });
  const attribution = await getReferralAttributionFromCookies().catch(() => undefined);
  return recordHandoff(listing, attribution?.code ?? null);
}

/**
 * POST /api/rails/:slug/handoff
 *
 * A traveller is about to open the operator's FareHarbor checkout. Records the hand-off
 * and returns the checkout tagged with Bluepass's affiliate shortname and a reference of
 * its own, which FareHarbor files as the booking's voucher number.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const handoff = await handOff(slug);
  if (!handoff) return NextResponse.json({ error: "This trip does not book through FareHarbor." }, { status: 404 });
  return NextResponse.json(handoff);
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram/i;

/**
 * GET /api/rails/:slug/handoff?go=1
 *
 * The same, as a link: records the hand-off and sends the browser to the checkout. Used
 * where script cannot open FareHarbor's overlay (inside an operator's iframe, or before
 * the page has loaded). Link previews and crawlers are sent on without a hand-off, so
 * they never count as travellers.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (BOT.test(request.headers.get("user-agent") ?? "")) {
    return NextResponse.redirect(new URL(`/book/${slug}`, request.url), 302);
  }
  const handoff = await handOff(slug);
  if (!handoff) return NextResponse.redirect(new URL(`/book/${slug}`, request.url), 302);
  return NextResponse.redirect(handoff.url, 302);
}
