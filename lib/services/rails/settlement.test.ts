import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { confirmPayment, reserveSeats } from "@/lib/services/rails/bookings";
import { settleNativeBookings } from "@/lib/services/rails/settlement";
import { EARLY, fakePayments, resetRailsTables, seedOperator, THURSDAY_8AM } from "@/lib/services/rails/test-fixtures";

beforeEach(async () => {
  await resetRailsTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function paidBooking(connect: boolean) {
  const seeded = await seedOperator();
  if (connect) {
    await prisma.operatorProfile.update({
      where: { id: seeded.profile.id },
      data: { payoutMethod: "STRIPE_CONNECT", stripeConnectAccountId: `acct_${seeded.profile.id}`, stripePayoutsEnabled: true },
    });
  }
  const r = await reserveSeats({
    listingId: seeded.listing.id, departsAt: THURSDAY_8AM, quantities: { [seeded.adult.id]: 2 },
    lead: { name: "Mia Torres", email: "mia@example.test" }, source: "ONLINE", now: EARLY,
  });
  if (!r.ok) throw new Error(r.reason);
  await confirmPayment({ bookingId: r.booking.id, sessionId: "cs", paymentIntentId: "pi_1", amountTotal: 37800, currency: "aud", now: EARLY }, fakePayments().payments);
  return { ...seeded, booking: r.booking };
}

describe("settleNativeBookings", () => {
  it("waits until the trip has run before paying anyone", async () => {
    await paidBooking(true);
    const { payments, calls } = fakePayments();
    const run = await settleNativeBookings({ payments, now: new Date("2026-07-16T12:00:00Z") });
    expect(run.settled).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("pays the operator's share once, tied to the charge, and never again", async () => {
    const { booking, profile } = await paidBooking(true);
    const { payments, calls } = fakePayments();
    const after = new Date("2026-07-17T00:00:00Z");

    expect(await settleNativeBookings({ payments, now: after })).toMatchObject({ settled: 1, settledCents: { AUD: 30240 } });
    expect(await settleNativeBookings({ payments, now: after })).toMatchObject({ settled: 0 });

    const transfers = calls.filter((c) => c.kind === "transfer");
    expect(transfers).toEqual([expect.objectContaining({
      amountCents: 30240, destination: `acct_${profile.id}`, sourceTransaction: "ch_for_pi_1", idempotencyKey: `rails-settle-${booking.id}`,
    })]);
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ settledAt: after, stripeTransferId: expect.any(String) });
  });

  it("leaves an operator with no Connect account owed, not paid some other way", async () => {
    await paidBooking(false);
    const { payments, calls } = fakePayments();
    expect(await settleNativeBookings({ payments, now: new Date("2026-07-17T00:00:00Z") }))
      .toMatchObject({ settled: 0, awaitingPayoutDetails: 1 });
    expect(calls).toHaveLength(0);
  });
});
