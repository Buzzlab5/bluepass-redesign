import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { listDepartures } from "@/lib/services/operators/listing-availability";
import {
  cancelBooking,
  cancelDeparture,
  confirmPayment,
  createOperatorBooking,
  expireLapsedBookings,
  HOLD_MINUTES,
  markCollected,
  reserveAndCheckout,
  reserveSeats,
  setCheckedIn,
  setDepartureOverride,
} from "@/lib/services/rails/bookings";
import { EARLY, fakePayments, resetRailsTables, seedOperator, THURSDAY_8AM } from "@/lib/services/rails/test-fixtures";

const lead = { name: "Mia Torres", email: "mia@example.test", phone: "+61411111111" };
const urls = { success: (b: { reference: string }) => `http://x/ok/${b.reference}`, cancel: (b: { id: string }) => `http://x/back?release=${b.id}` };

beforeEach(async () => {
  await resetRailsTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seatsLeftThursday(listingId: string, now = EARLY) {
  const [day] = await listDepartures({ listingId, from: "2026-07-16", to: "2026-07-16", now });
  return day.departures[0].seatsLeft;
}

describe("reserveSeats", () => {
  it("prices the party from the rate card and holds exactly those seats", async () => {
    const { listing, adult, child } = await seedOperator();
    const r = await reserveSeats({
      listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 2, [child.id]: 1 },
      lead, source: "ONLINE", now: EARLY,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking).toMatchObject({ guests: 3, totalCents: 47700, currency: "AUD", status: "PENDING_PAYMENT", timezone: "Australia/Brisbane" });
    expect(r.booking.reference).toMatch(/^BP-[2-9A-Z]{6}$/);
    expect(r.booking.expiresAt!.getTime() - EARLY.getTime()).toBe(HOLD_MINUTES * 60_000);
    expect(await seatsLeftThursday(listing.id)).toBe(9);
  });

  it("sells the last seats exactly once when travellers race for them", async () => {
    const { listing, adult } = await seedOperator({ capacity: 3 });
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        reserveSeats({
          listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 1 },
          lead: { ...lead, email: `racer${i}@example.test` }, source: "ONLINE", now: EARLY,
        }),
      ),
    );
    expect(attempts.filter((a) => a.ok)).toHaveLength(3);
    const refused = attempts.filter((a) => !a.ok);
    expect(refused).toHaveLength(5);
    expect(refused.every((a) => !a.ok && a.reason.includes("fully booked"))).toBe(true);
    expect(await prisma.listingSeatHold.count({ where: { listingId: listing.id } })).toBe(3);
  });

  it("refuses a departure the schedule does not produce, whatever the page submitted", async () => {
    const { listing, adult } = await seedOperator();
    const wednesday = new Date("2026-07-14T22:00:00Z");
    const r = await reserveSeats({ listingId: listing.id, departsAt: wednesday, quantities: { [adult.id]: 1 }, lead, source: "ONLINE", now: EARLY });
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("closes online sales at the cutoff but lets the operator take a phone booking", async () => {
    const { listing, profile, adult } = await seedOperator();
    const morningOf = new Date("2026-07-15T20:00:00Z");
    const online = await reserveSeats({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 2 }, lead, source: "ONLINE", now: morningOf });
    expect(online).toMatchObject({ ok: false });
    if (!online.ok) expect(online.reason).toContain("24 hours");

    const phone = await createOperatorBooking({
      operatorProfileId: profile.id, listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 2 },
      lead: { name: "Walk-up Sam" }, paid: true, sendConfirmation: false, actorEmail: "op@example.test", now: morningOf,
    });
    expect(phone.ok).toBe(true);
    if (!phone.ok) return;
    expect(phone.booking).toMatchObject({ status: "CONFIRMED", source: "OPERATOR", paymentStatus: "PAID_TO_OPERATOR", conservationCents: 0, totalCents: 37800 });
  });

  it("refuses a lapsed listing and a party with no email", async () => {
    const { listing, adult } = await seedOperator();
    expect(await reserveSeats({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 1 }, lead: { name: "No Email" }, source: "ONLINE", now: EARLY }))
      .toMatchObject({ ok: false, code: "INVALID" });
    await prisma.operatorListing.update({ where: { id: listing.id }, data: { status: "ARCHIVED" } });
    expect(await reserveSeats({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 1 }, lead, source: "ONLINE", now: EARLY }))
      .toMatchObject({ ok: false, code: "NOT_BOOKABLE" });
  });
});

describe("reserveAndCheckout", () => {
  it("opens a payment page for what was reserved", async () => {
    const { listing, adult } = await seedOperator();
    const { payments, calls } = fakePayments();
    const r = await reserveAndCheckout({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 2 }, lead, source: "ONLINE", now: EARLY }, payments, urls);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.checkoutUrl).toContain("checkout.stripe.test");
    expect(r.booking.stripeCheckoutSessionId).toBe("cs_test_1");
    expect(calls[0]).toMatchObject({ kind: "checkout", currency: "AUD", lines: [{ label: "Adult", amountCents: 18900, quantity: 2 }] });
  });

  it("gives the seats straight back when the payment page cannot be opened", async () => {
    const { listing, adult } = await seedOperator();
    const { payments } = fakePayments({ failCheckout: true });
    const r = await reserveAndCheckout({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 2 }, lead, source: "ONLINE", now: EARLY }, payments, urls);
    expect(r).toMatchObject({ ok: false, code: "PAYMENT_FAILED" });
    expect(await seatsLeftThursday(listing.id)).toBe(12);
  });

  it("does not hold anything when online payment is switched off", async () => {
    const { listing, adult } = await seedOperator();
    const r = await reserveAndCheckout({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 2 }, lead, source: "ONLINE", now: EARLY }, null, urls);
    expect(r).toMatchObject({ ok: false, code: "PAYMENTS_OFF" });
    expect(await prisma.listingBooking.count()).toBe(0);
  });
});

describe("confirmPayment", () => {
  async function reserved(capacity = 12, guests = 2) {
    const seeded = await seedOperator({ capacity });
    const r = await reserveSeats({
      listingId: seeded.listing.id, departsAt: THURSDAY_8AM, quantities: { [seeded.adult.id]: guests }, lead, source: "ONLINE", now: EARLY,
    });
    if (!r.ok) throw new Error(r.reason);
    return { ...seeded, booking: r.booking };
  }

  it("confirms, records the 5% and the operator's share, and is safe to deliver twice", async () => {
    const { booking, listing } = await reserved();
    const { payments } = fakePayments();
    const paid = { bookingId: booking.id, sessionId: "cs_1", paymentIntentId: "pi_1", amountTotal: 37800, currency: "aud", now: EARLY };

    expect(await confirmPayment(paid, payments)).toBe("confirmed");
    expect(await confirmPayment(paid, payments)).toBe("already_confirmed");

    const after = await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after).toMatchObject({
      status: "CONFIRMED", paymentStatus: "PAID", conservationCents: 1890, operatorNetCents: 30240,
      stripePaymentIntentId: "pi_1", stripeChargeId: "ch_for_pi_1", expiresAt: null,
    });
    const hold = await prisma.listingSeatHold.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(hold).toMatchObject({ confirmed: true, expiresAt: null });
    // A confirmed seat stays taken long after any hold would have lapsed.
    expect(await seatsLeftThursday(listing.id, new Date("2026-07-10T00:00:00Z"))).toBe(10);
  });

  it("still seats a traveller who paid after the hold lapsed, if the seats are free", async () => {
    const { booking } = await reserved();
    const late = new Date(EARLY.getTime() + (HOLD_MINUTES + 5) * 60_000);
    expect(await expireLapsedBookings(late)).toBe(1);
    const { payments, calls } = fakePayments();
    expect(await confirmPayment({ bookingId: booking.id, sessionId: "cs_1", paymentIntentId: "pi_1", amountTotal: 37800, currency: "aud", now: late }, payments))
      .toBe("confirmed");
    expect(calls.some((c) => c.kind === "refund")).toBe(false);
  });

  it("refunds in full a traveller who paid after their seats were resold", async () => {
    const { booking, listing, adult } = await reserved(2, 2);
    const late = new Date(EARLY.getTime() + (HOLD_MINUTES + 5) * 60_000);
    const resold = await reserveSeats({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 2 }, lead: { ...lead, email: "second@example.test" }, source: "ONLINE", now: late });
    expect(resold.ok).toBe(true);

    const { payments, calls } = fakePayments();
    expect(await confirmPayment({ bookingId: booking.id, sessionId: "cs_1", paymentIntentId: "pi_1", amountTotal: 37800, currency: "aud", now: late }, payments))
      .toBe("refunded_full");
    expect(calls.filter((c) => c.kind === "refund")).toEqual([expect.objectContaining({ paymentIntentId: "pi_1", amountCents: 37800 })]);
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } }))
      .toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED", refundedCents: 37800 });
  });

  it("refunds a payment that lands after the operator cancelled the pending booking", async () => {
    const { booking, profile } = await reserved();
    const { payments, calls } = fakePayments();
    expect((await cancelBooking({ bookingId: booking.id, operatorProfileId: profile.id, actor: "op", reason: "Boat in the shed", now: EARLY }, payments)).ok).toBe(true);
    expect(await confirmPayment({ bookingId: booking.id, sessionId: "cs_1", paymentIntentId: "pi_9", amountTotal: 37800, currency: "aud", now: EARLY }, payments))
      .toBe("refunded_cancelled");
    expect(calls.filter((c) => c.kind === "refund")).toHaveLength(1);
  });
});

describe("cancelling", () => {
  async function confirmedBooking() {
    const seeded = await seedOperator();
    const r = await reserveSeats({ listingId: seeded.listing.id, departsAt: THURSDAY_8AM, quantities: { [seeded.adult.id]: 2 }, lead, source: "ONLINE", now: EARLY });
    if (!r.ok) throw new Error(r.reason);
    await confirmPayment({ bookingId: r.booking.id, sessionId: "cs_1", paymentIntentId: "pi_1", amountTotal: 37800, currency: "aud", now: EARLY }, fakePayments().payments);
    return { ...seeded, booking: r.booking };
  }

  it("refunds a paid booking in full, once, and frees its seats", async () => {
    const { booking, profile, listing } = await confirmedBooking();
    const { payments, calls } = fakePayments();
    const r = await cancelBooking({ bookingId: booking.id, operatorProfileId: profile.id, actor: "op@example.test", reason: "Engine fault", now: EARLY }, payments);
    expect(r).toEqual({ ok: true, refundedCents: 37800 });
    expect(await cancelBooking({ bookingId: booking.id, operatorProfileId: profile.id, actor: "op", reason: "again", now: EARLY }, payments))
      .toMatchObject({ ok: false, code: "ALREADY_DONE" });
    expect(calls.filter((c) => c.kind === "refund")).toHaveLength(1);
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } }))
      .toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED", conservationCents: 0, operatorNetCents: 0 });
    expect(await seatsLeftThursday(listing.id)).toBe(12);
  });

  it("changes nothing when the refund fails", async () => {
    const { booking, profile, listing } = await confirmedBooking();
    const { payments } = fakePayments({ failRefund: true });
    expect(await cancelBooking({ bookingId: booking.id, operatorProfileId: profile.id, actor: "op", reason: "x", now: EARLY }, payments))
      .toMatchObject({ ok: false, code: "PAYMENT_FAILED" });
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(await seatsLeftThursday(listing.id)).toBe(10);
  });

  it("will not let one operator touch another's booking", async () => {
    const { booking } = await confirmedBooking();
    const other = await seedOperator();
    expect(await cancelBooking({ bookingId: booking.id, operatorProfileId: other.profile.id, actor: "x", reason: "x", now: EARLY }, fakePayments().payments))
      .toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await setCheckedIn({ bookingId: booking.id, operatorProfileId: other.profile.id, checkedIn: true, actor: "x" }))
      .toMatchObject({ ok: false });
  });

  it("cancels a whole departure for weather, refunds everyone and closes it", async () => {
    const { profile, listing, adult } = await confirmedBooking();
    await createOperatorBooking({
      operatorProfileId: profile.id, listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 1 },
      lead: { name: "Phone Pat" }, paid: true, sendConfirmation: false, actorEmail: "op", now: EARLY,
    });
    const { payments, calls } = fakePayments();
    const r = await cancelDeparture({ listingId: listing.id, departsAt: THURSDAY_8AM, operatorProfileId: profile.id, actor: "op", reason: "Strong wind warning", now: EARLY }, payments);
    expect(r).toEqual({ ok: true, cancelled: 2, refundedCents: 37800, failed: [] });
    expect(calls.filter((c) => c.kind === "refund")).toHaveLength(1);
    const again = await reserveSeats({ listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 1 }, lead, source: "ONLINE", now: EARLY });
    expect(again).toMatchObject({ ok: false });
    if (!again.ok) expect(again.reason).toContain("not running");
  });
});

describe("departure overrides and operator tools", () => {
  it("raises capacity for one departure but never below what is sold", async () => {
    const { profile, listing, adult } = await seedOperator({ capacity: 4 });
    await createOperatorBooking({
      operatorProfileId: profile.id, listingId: listing.id, departsAt: THURSDAY_8AM, quantities: { [adult.id]: 3 },
      lead: { name: "Group" }, paid: false, sendConfirmation: false, actorEmail: "op", now: EARLY,
    });
    expect(await setDepartureOverride({ listingId: listing.id, departsAt: THURSDAY_8AM, operatorProfileId: profile.id, closed: false, capacity: 2, note: null, now: EARLY }))
      .toMatchObject({ ok: false });
    expect(await setDepartureOverride({ listingId: listing.id, departsAt: THURSDAY_8AM, operatorProfileId: profile.id, closed: false, capacity: 10, note: "Second boat", now: EARLY }))
      .toEqual({ ok: true });
    expect(await seatsLeftThursday(listing.id)).toBe(7);
    // Setting it back to the rule's own number removes the exception entirely.
    await setDepartureOverride({ listingId: listing.id, departsAt: THURSDAY_8AM, operatorProfileId: profile.id, closed: false, capacity: 4, note: null, now: EARLY });
    expect(await prisma.listingDepartureOverride.count()).toBe(0);
  });

  it("takes a head-count booking with a hand-set price when no rate fits", async () => {
    const { profile, listing } = await seedOperator();
    const r = await createOperatorBooking({
      operatorProfileId: profile.id, listingId: listing.id, departsAt: THURSDAY_8AM, quantities: {}, guests: 5, totalCents: 80000,
      lead: { name: "Hotel desk" }, paid: false, sendConfirmation: false, actorEmail: "op", now: EARLY,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking).toMatchObject({ guests: 5, totalCents: 80000, paymentStatus: "UNPAID" });
    expect(await markCollected({ bookingId: r.booking.id, operatorProfileId: profile.id, actor: "op" })).toEqual({ ok: true });
    expect(await setCheckedIn({ bookingId: r.booking.id, operatorProfileId: profile.id, checkedIn: true, actor: "op" })).toEqual({ ok: true });
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: r.booking.id } }))
      .toMatchObject({ paymentStatus: "PAID_TO_OPERATOR", checkedInAt: expect.any(Date) });
  });
});
