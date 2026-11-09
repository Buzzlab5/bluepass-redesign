import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { handleStripeAccountUpdated, verifyStripeConnectWebhookEvent } from "@/lib/services/stripe/stripe-connect-webhook";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  // Raw text, not .json() - Stripe's signature check is over the exact request bytes.
  const rawBody = await request.text();

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe-Signature header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeConnectWebhookEvent(rawBody, signature);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stripe webhook signature verification failed." },
      { status: 400 },
    );
  }

  // A handler failure answers 500 so Stripe redelivers. Safe because the handler only sets the
  // operator's two capability flags from the event, so replaying it changes nothing the second time.
  // Answering 200 would leave an operator stuck un-payable after one transient DB error.
  try {
    if (event.type === "account.updated") {
      await handleStripeAccountUpdated(event.data.object as Stripe.Account);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("stripe_connect_webhook.handler_failed", { eventType: event.type, error: message });
    return NextResponse.json({ received: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
