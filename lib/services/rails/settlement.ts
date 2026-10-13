import { prisma } from "@/lib/db/prisma";
import type { RailsPayments } from "@/lib/services/rails/payments";

/**
 * Pays operators for native bookings once the trip has run.
 *
 * The money is held until then on purpose: it is what lets the booking page tell a
 * traveller their payment is safe until the boat goes out, and it is what makes an
 * operator's cancellation refundable without chasing the operator for it.
 *
 * A day's grace after departure covers the trip that comes back late, and the
 * operator who cancels for weather at the jetty. Each payout is one Stripe transfer
 * per booking with an idempotency key on the booking, so a run that dies halfway
 * and is retried pays nobody twice.
 *
 * Operators without a Stripe Connect account with payouts switched on are left
 * owed rather than paid some other way. Their total shows on their dashboard, and
 * the payout itself follows the existing admin payout path for that operator.
 */
export const SETTLE_AFTER_HOURS = 24;

export type SettlementRun = {
  settled: number;
  settledCents: Record<string, number>;
  awaitingPayoutDetails: number;
  failed: { reference: string; error: string }[];
};

export async function settleNativeBookings(input: { payments: RailsPayments; now?: Date; limit?: number }): Promise<SettlementRun> {
  const now = input.now ?? new Date();
  const due = await prisma.listingBooking.findMany({
    where: {
      status: "CONFIRMED",
      paymentStatus: "PAID",
      settledAt: null,
      operatorNetCents: { gt: 0 },
      departsAt: { lt: new Date(now.getTime() - SETTLE_AFTER_HOURS * 3_600_000) },
    },
    include: {
      operatorProfile: { select: { payoutMethod: true, stripeConnectAccountId: true, stripePayoutsEnabled: true } },
    },
    orderBy: { departsAt: "asc" },
    take: input.limit ?? 200,
  });

  const run: SettlementRun = { settled: 0, settledCents: {}, awaitingPayoutDetails: 0, failed: [] };

  for (const booking of due) {
    const p = booking.operatorProfile;
    if (p.payoutMethod !== "STRIPE_CONNECT" || !p.stripeConnectAccountId || !p.stripePayoutsEnabled) {
      run.awaitingPayoutDetails += 1;
      continue;
    }
    try {
      let chargeId = booking.stripeChargeId;
      if (!chargeId && booking.stripePaymentIntentId) chargeId = await input.payments.chargeIdFor(booking.stripePaymentIntentId);

      const transfer = await input.payments.transfer({
        amountCents: booking.operatorNetCents,
        currency: booking.currency,
        destination: p.stripeConnectAccountId,
        sourceTransaction: chargeId,
        transferGroup: booking.reference,
        idempotencyKey: `rails-settle-${booking.id}`,
        bookingReference: booking.reference,
      });
      await prisma.$transaction([
        prisma.listingBooking.update({
          where: { id: booking.id },
          data: { settledAt: now, stripeTransferId: transfer.id, stripeChargeId: chargeId },
        }),
        prisma.listingBookingEvent.create({
          data: { bookingId: booking.id, type: "settled", actor: "system", payload: { transferId: transfer.id, amountCents: booking.operatorNetCents } },
        }),
      ]);
      run.settled += 1;
      run.settledCents[booking.currency] = (run.settledCents[booking.currency] ?? 0) + booking.operatorNetCents;
    } catch (error) {
      run.failed.push({ reference: booking.reference, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return run;
}
