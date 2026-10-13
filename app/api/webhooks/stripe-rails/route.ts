import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db/prisma";
import { syncCalendarSoon } from "@/lib/services/rails/background";
import { confirmPayment, expireCheckout } from "@/lib/services/rails/bookings";
import { RAILS_CHECKOUT_KIND, railsPayments, verifyRailsWebhook } from "@/lib/services/rails/payments";

/**
 * Stripe events for native bookings. Registered as its own endpoint on the Bluepass
 * Stripe account, subscribed to checkout.session.completed,
 * checkout.session.async_payment_succeeded and checkout.session.expired.
 *
 * Kai's checkouts are on the same account and arrive here too; anything without our
 * metadata marker is acknowledged and ignored.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();
  if (!signature) return NextResponse.json({ error: "Missing Stripe-Signature header." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = verifyRailsWebhook(rawBody, signature);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Signature check failed." }, { status: 400 });
  }

  if (!event.type.startsWith("checkout.session.")) return NextResponse.json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  const bookingId = session.metadata?.kind === RAILS_CHECKOUT_KIND ? session.metadata.bookingId : undefined;
  if (!bookingId) return NextResponse.json({ received: true, ignored: true });

  try {
    if (
      (event.type === "checkout.session.completed" && session.payment_status === "paid") ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const intent = session.payment_intent;
      const outcome = await confirmPayment(
        {
          bookingId,
          sessionId: session.id,
          paymentIntentId: typeof intent === "string" ? intent : intent?.id ?? null,
          amountTotal: session.amount_total,
          currency: session.currency,
        },
        railsPayments(),
      );
      const booking = await prisma.listingBooking.findUnique({ where: { id: bookingId }, select: { operatorProfileId: true } });
      if (booking) syncCalendarSoon(booking.operatorProfileId);
      return NextResponse.json({ received: true, outcome });
    }
    if (event.type === "checkout.session.expired") {
      await expireCheckout(bookingId);
      return NextResponse.json({ received: true, outcome: "expired" });
    }
  } catch (error) {
    // A 500 makes Stripe retry, which is what we want for a confirmation that failed
    // halfway: confirmPayment is idempotent, so the retry finishes the job.
    console.error("rails.webhook_failed", { type: event.type, bookingId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Handler failed; Stripe will retry." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
