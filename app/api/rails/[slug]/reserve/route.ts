import { NextResponse } from "next/server";
import { z } from "zod";
import { rezdyApi } from "@/lib/services/channels/rezdy/api";
import { reserveRezdy } from "@/lib/services/channels/rezdy/booking";
import { bookableTrip } from "@/lib/services/channels/trips";
import { reserveAndCheckout } from "@/lib/services/rails/bookings";
import { googleCalendarApi } from "@/lib/services/rails/google/api";
import { liveBusyCheck } from "@/lib/services/rails/google/sync";
import { railsPayments } from "@/lib/services/rails/payments";
import { getReferralAttributionFromCookies } from "@/lib/services/referrals/attribution";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  departsAt: z.string().datetime(),
  quantities: z.record(z.string(), z.number().int().min(0).max(500)),
  /** Add-ons chosen, by name (Rezdy trips). */
  extras: z.record(z.string().max(200), z.number().int().min(0).max(50)).optional().nullable(),
  guests: z.number().int().min(1).max(500).optional(),
  lead: z.object({
    name: z.string().max(120),
    email: z.string().max(200),
    phone: z.string().max(40).optional().nullable(),
  }),
  notes: z.string().max(1000).optional().nullable(),
  /** The guest ticked "send my booking on WhatsApp" next to their number. */
  whatsappOptIn: z.boolean().optional(),
  /** Where Stripe sends the traveller back to if they leave the payment page. */
  returnTo: z.enum(["page", "embed"]).optional(),
  /** Rezdy automated payments: the card, tokenised in the browser on Rezdy's Stripe account. */
  cardToken: z.string().regex(/^tok_[A-Za-z0-9_]+$/).max(200).optional().nullable(),
  /** The total the traveller was shown. A Rezdy trip whose quote differs is refused before any charge. */
  expectedTotalCents: z.number().int().min(0).max(100_000_000).optional().nullable(),
  /** Answers to the operator's own booking questions, and the pickup chosen. */
  answers: z
    .object({
      fields: z.record(z.string().max(200), z.string().max(500)).default({}),
      participants: z.array(z.record(z.string().max(200), z.string().max(500))).max(100).default([]),
      pickup: z.string().max(200).nullable().default(null),
    })
    .optional()
    .nullable(),
});

/** Kai, or any agent holding one of the bridge tokens, books as an agent rather than a traveller. */
function isAgent(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  return [process.env.KAI_CORE_ADMIN_TOKEN, process.env.BLUEPASS_SERVICE_TOKEN]
    .map((v) => v?.trim())
    .filter(Boolean)
    .includes(token);
}

function siteUrl(request: Request) {
  return (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
}

/**
 * POST /api/rails/:slug/reserve
 *
 * Holds the seats and returns a Stripe payment page for them. The price is worked
 * out from the operator's rates on the server; nothing the request says about money
 * is read. The seats are held for half an hour and let go on their own if the
 * traveller never pays.
 *
 * A Rezdy trip on automated payments is booked and charged in this one call, with a
 * card token from the browser, and answers with the confirmation page instead. Its
 * price is Rezdy's quote; `expectedTotalCents` only lets a changed price be refused
 * before the card is touched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Some booking details are missing." }, { status: 400 });

  const trip = await bookableTrip(slug);
  if (!trip) return NextResponse.json({ error: "This trip is not taking bookings." }, { status: 404 });
  if (trip.kind === "fareharbor") {
    return NextResponse.json(
      { error: "This trip books on the operator's FareHarbor checkout.", code: "EXTERNAL_CHECKOUT", bookingUrl: `${siteUrl(request)}/book/${slug}` },
      { status: 409 },
    );
  }

  // A last look at the operator's own diary before seats are held and money is taken.
  const google = googleCalendarApi();
  if (google && (await liveBusyCheck(trip.listing.id, new Date(parsed.data.departsAt), { api: google })) === true) {
    return NextResponse.json({ error: "The operator is not running that departure. Another date will work.", code: "UNAVAILABLE" }, { status: 409 });
  }

  const agent = isAgent(request);
  const attribution = agent ? undefined : await getReferralAttributionFromCookies().catch(() => undefined);
  const site = siteUrl(request);
  const back = parsed.data.returnTo === "embed" ? `${site}/embed/book/${slug}` : `${site}/book/${slug}`;
  const urls = {
    // {CHECKOUT_SESSION_ID} is filled in by Stripe. Only the paying browser ever sees it,
    // which is what makes it safe to look the booking up by.
    success: () => `${site}/book/${slug}/confirmed?session_id={CHECKOUT_SESSION_ID}`,
    // Coming back from the payment page means they changed their mind: the page uses
    // this to let the seats go now instead of when the hold runs out.
    cancel: (booking: { id: string }) => `${back}?release=${booking.id}`,
  };

  if (trip.kind === "rezdy") {
    // A card can only be tokenised in a browser, so an agent selling an automated-payment
    // trip sends the traveller to the booking page instead.
    if (trip.mode === "automated" && !parsed.data.cardToken) {
      return NextResponse.json(
        { error: "This trip is paid by card on its booking page.", code: "PAY_ON_PAGE", bookingUrl: `${site}/book/${slug}` },
        { status: 409 },
      );
    }
    const result = await reserveRezdy(
      {
        listingId: trip.listing.id,
        departsAt: new Date(parsed.data.departsAt),
        quantities: parsed.data.quantities,
        extras: parsed.data.extras ?? null,
        lead: parsed.data.lead,
        notes: parsed.data.notes,
        answers: parsed.data.answers ?? null,
        whatsappOptIn: parsed.data.whatsappOptIn,
        referralCode: attribution?.code ?? null,
        source: agent ? "KAI" : "ONLINE",
        cardToken: parsed.data.cardToken ?? null,
        expectedTotalCents: parsed.data.expectedTotalCents ?? null,
      },
      trip.trip,
      { api: rezdyApi(), payments: railsPayments() },
      urls,
    );
    if (!result.ok) {
      const status = result.code === "UNAVAILABLE" || result.code === "INVALID" || result.code === "PRICE_CHANGED" ? 409
        : result.code === "PAYMENT_FAILED" ? 402 : result.code === "PAYMENTS_OFF" ? 503 : 502;
      return NextResponse.json({ error: result.reason, code: result.code, ...(result.totalCents ? { totalCents: result.totalCents } : {}) }, { status });
    }
    const booking = result.booking;
    return NextResponse.json({
      reference: booking.reference,
      bookingId: booking.id,
      status: booking.status,
      ...(result.kind === "checkout" ? { checkoutUrl: result.checkoutUrl } : { confirmationUrl: `${site}/book/${slug}/confirmed?booking=${booking.guestToken}` }),
      expiresAt: booking.expiresAt,
      guests: booking.guests,
      totalCents: booking.totalCents,
      currency: booking.currency,
      lines: booking.lines,
    });
  }

  const b = trip.native;
  const result = await reserveAndCheckout(
    {
      listingId: b.listing.id,
      departsAt: new Date(parsed.data.departsAt),
      quantities: parsed.data.quantities,
      guests: parsed.data.guests,
      lead: parsed.data.lead,
      notes: parsed.data.notes,
      whatsappOptIn: parsed.data.whatsappOptIn,
      referralCode: attribution?.code ?? null,
      source: agent ? "KAI" : "ONLINE",
    },
    railsPayments(),
    urls,
  );

  if (!result.ok) {
    const status = result.code === "UNAVAILABLE" || result.code === "INVALID" ? 409 : result.code === "PAYMENTS_OFF" ? 503 : 502;
    return NextResponse.json({ error: result.reason, code: result.code }, { status });
  }

  return NextResponse.json({
    reference: result.booking.reference,
    bookingId: result.booking.id,
    checkoutUrl: result.checkoutUrl,
    expiresAt: result.booking.expiresAt,
    guests: result.booking.guests,
    totalCents: result.booking.totalCents,
    currency: result.booking.currency,
    lines: result.booking.lines,
  });
}
