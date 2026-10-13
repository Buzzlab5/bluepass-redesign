import Stripe from "stripe";

/**
 * Everything the booking engine needs from a payment provider, and nothing else.
 *
 * Kept as a port rather than calls into the Stripe SDK from the engine so the engine
 * can be tested against a fake that records what it was asked to do. The questions
 * worth testing ("does a cancelled paid booking get its money back exactly once")
 * are about the engine's decisions, not about Stripe.
 *
 * Until now this app never held Bluepass's Stripe secret key; Kai did, and created
 * every checkout on this app's behalf. Native bookings are this app's own inventory,
 * so it charges for them itself. Use a RESTRICTED key (rk_...) with only: Checkout
 * Sessions write, Refunds write, Transfers write, PaymentIntents read. Nothing here
 * creates accounts or touches balances beyond that.
 */
export type CheckoutRequest = {
  bookingId: string;
  reference: string;
  currency: string;
  lines: { label: string; amountCents: number; quantity: number }[];
  productName: string;
  description: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
};

export type CheckoutState = {
  bookingId: string | null;
  paid: boolean;
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
};

export type RailsPayments = {
  createCheckout(input: CheckoutRequest): Promise<{ id: string; url: string }>;
  /** Best effort: stops an abandoned checkout being paid after its seats were let go. */
  expireCheckout(sessionId: string): Promise<void>;
  /**
   * Reads a checkout back from Stripe. The confirmation page uses it so a traveller
   * who has paid sees their booking confirmed even if the webhook is running late.
   */
  retrieveCheckout(sessionId: string): Promise<CheckoutState>;
  refund(input: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
    bookingReference: string;
  }): Promise<{ id: string }>;
  /** The charge behind a payment, which a payout transfer is tied to. */
  chargeIdFor(paymentIntentId: string): Promise<string | null>;
  transfer(input: {
    amountCents: number;
    currency: string;
    destination: string;
    sourceTransaction: string | null;
    transferGroup: string;
    idempotencyKey: string;
    bookingReference: string;
  }): Promise<{ id: string }>;
};

/** Marks a checkout as ours. Kai's checkouts arrive on the same Stripe account. */
export const RAILS_CHECKOUT_KIND = "bluepass_rails_booking";

export function stripeSecretKey(env: Record<string, string | undefined> = process.env) {
  return env.STRIPE_SECRET_KEY?.trim() || null;
}

let cached: { key: string; client: Stripe } | null = null;

function client(key: string) {
  if (cached?.key !== key) cached = { key, client: new Stripe(key) };
  return cached.client;
}

/** The live adapter, or null when no key is configured: online payment is then switched off. */
export function railsPayments(env: Record<string, string | undefined> = process.env): RailsPayments | null {
  const key = stripeSecretKey(env);
  if (!key) return null;
  const stripe = client(key);

  return {
    async createCheckout(input) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: input.bookingId,
          customer_email: input.customerEmail,
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          line_items: input.lines.map((line) => ({
            quantity: line.quantity,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: line.amountCents,
              product_data: {
                name: `${input.productName} · ${line.label}`,
                description: input.description,
              },
            },
          })),
          metadata: { kind: RAILS_CHECKOUT_KIND, bookingId: input.bookingId, reference: input.reference },
          payment_intent_data: {
            description: `${input.reference} · ${input.productName}`,
            transfer_group: input.reference,
            metadata: { kind: RAILS_CHECKOUT_KIND, bookingId: input.bookingId, reference: input.reference },
          },
        },
        { idempotencyKey: `rails-checkout-${input.bookingId}` },
      );
      if (!session.url) throw new Error("Stripe returned a checkout without a payment page.");
      return { id: session.id, url: session.url };
    },

    async expireCheckout(sessionId) {
      try {
        await stripe.checkout.sessions.expire(sessionId);
      } catch {
        // Already completed or already expired; either way there is nothing left to stop.
      }
    },

    async retrieveCheckout(sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const intent = session.payment_intent;
      return {
        bookingId: session.metadata?.kind === RAILS_CHECKOUT_KIND ? session.metadata.bookingId ?? null : null,
        paid: session.payment_status === "paid",
        paymentIntentId: typeof intent === "string" ? intent : intent?.id ?? null,
        amountTotal: session.amount_total,
        currency: session.currency,
      };
    },

    async refund(input) {
      const refund = await stripe.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: input.amountCents,
          metadata: { kind: RAILS_CHECKOUT_KIND, reference: input.bookingReference },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: refund.id };
    },

    async chargeIdFor(paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const charge = intent.latest_charge;
      if (!charge) return null;
      return typeof charge === "string" ? charge : charge.id;
    },

    async transfer(input) {
      const transfer = await stripe.transfers.create(
        {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          destination: input.destination,
          transfer_group: input.transferGroup,
          // Tying the transfer to its charge lets it be made before the charge's funds
          // settle; it waits on them rather than failing for want of a balance.
          ...(input.sourceTransaction ? { source_transaction: input.sourceTransaction } : {}),
          metadata: { kind: RAILS_CHECKOUT_KIND, reference: input.bookingReference },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return { id: transfer.id };
    },
  };
}

/**
 * Verifies a delivery to this app's rails webhook endpoint. Its own signing secret,
 * separate from the Connect endpoint's, because Stripe signs per endpoint.
 */
export function verifyRailsWebhook(
  rawBody: string,
  signature: string,
  env: Record<string, string | undefined> = process.env,
): Stripe.Event {
  const secret = env.STRIPE_RAILS_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("STRIPE_RAILS_WEBHOOK_SECRET is not configured.");
  // constructEvent only uses the signing secret; the key passed to the constructor is never sent.
  return new Stripe(stripeSecretKey(env) ?? "signature_check_only").webhooks.constructEvent(
    rawBody,
    signature,
    secret,
  );
}
