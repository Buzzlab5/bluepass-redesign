import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { replaceRezdyApiForTests } from "@/lib/services/channels/rezdy/api";
import {
  clearSessionCache,
  confirmRezdyPayment,
  reconcileRezdyBookings,
  reserveRezdy,
  rezdyDay,
  rezdyMonth,
  type RezdyTrip,
} from "@/lib/services/channels/rezdy/booking";
import { createRezdySim, reefRunnerOnRezdy } from "@/lib/services/channels/rezdy/sim";
import { connectRezdy, rezdyData } from "@/lib/services/channels/rezdy/sync";
import { zonedTimeToUtc } from "@/lib/services/operators/listing-availability";
import { cancelBooking, expireCheckout } from "@/lib/services/rails/bookings";
import { settleNativeBookings } from "@/lib/services/rails/settlement";
import { fakePayments, resetRailsTables } from "@/lib/services/rails/test-fixtures";

/**
 * Booking Rezdy trips against the simulator. The things worth proving are the ones a
 * traveller or an operator would notice: the price charged is Rezdy's, a full session
 * refuses before a card is touched, an abandoned checkout gives its seats back in
 * Rezdy, and a cancellation or a move made in Rezdy reaches the traveller with their
 * money.
 */

const NOW = new Date("2026-10-20T00:00:00Z");
const ZONE = "Australia/Brisbane";
/** 2 Nov 2026, 07:30 in Cairns: the reef trip's departure. */
const REEF_AT = zonedTimeToUtc("2026-11-02", "07:30", ZONE);
/** 2 Nov 2026, 17:00: the sunset sail. */
const SAIL_AT = zonedTimeToUtc("2026-11-02", "17:00", ZONE);
/** Wednesday 4 Nov 2026, 08:00: the private charter, which the operator accepts by hand. */
const CHARTER_AT = zonedTimeToUtc("2026-11-04", "08:00", ZONE);

let sim: ReturnType<typeof createRezdySim>;
let operatorProfileId: string;

async function trip(code: string): Promise<RezdyTrip> {
  const listing = await prisma.operatorListing.findFirstOrThrow({ where: { externalProductId: code } });
  return {
    listing: { id: listing.id, slug: listing.slug, title: listing.title, operatorProfileId: listing.operatorProfileId, currency: listing.currency },
    data: rezdyData(listing)!,
    timezone: ZONE,
    operatorName: "Reef Runner Charters",
  };
}

const lead = { name: "Mia Berg", email: "mia@example.test", phone: "+61412345678" };

beforeEach(async () => {
  await resetRailsTables();
  clearSessionCache();
  sim = createRezdySim({ ...reefRunnerOnRezdy("2026-11-01"), now: () => new Date() });
  replaceRezdyApiForTests(sim.api);
  const account = await prisma.bluePassAccount.create({ data: { email: "bookings@reefrunner.com.au", passwordHash: "x", roles: ["OPERATOR"] } });
  const profile = await prisma.operatorProfile.create({ data: { accountId: account.id, status: "APPROVED", companyName: "Reef Runner Charters" } });
  operatorProfileId = profile.id;
  await connectRezdy({ operatorProfileId, accountEmail: account.email, address: "reefrunner", now: NOW });
});

afterEach(() => replaceRezdyApiForTests(undefined));

describe("reading seats", () => {
  it("shows Rezdy's sessions and prices on the booking calendar", async () => {
    const reef = await trip("PRR001");
    const month = await rezdyMonth(reef, "2026-11", NOW, sim.api);
    expect(month.days.find((d) => d.date === "2026-11-02")).toMatchObject({ status: "available", seatsLeft: 24, fromCents: 12900 });
    const day = await rezdyDay(reef, "2026-11-02", NOW, sim.api);
    expect(day.departures).toHaveLength(1);
    expect(day.departures[0]).toMatchObject({ localTime: "07:30", available: true, departsAt: REEF_AT.toISOString() });
    expect(day.rates.map((r) => [r.id, r.amountCents, r.seatsUsed])).toEqual([["Adult", 22900, 1], ["Child", 12900, 1], ["Family of 4", 64000, 4]]);
  });
});

describe("automated payments: Rezdy charges the card", () => {
  it("books and charges in one step, at Rezdy's quoted total", async () => {
    const reef = await trip("PRR001");
    const result = await reserveRezdy({
      listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 2 }, lead, notes: "One vegetarian",
      answers: { fields: {}, participants: [], pickup: "Palm Cove" }, source: "ONLINE", cardToken: "tok_visa", expectedTotalCents: 46500, now: NOW,
    }, reef, { api: sim.api, payments: null });
    expect(result).toMatchObject({ ok: true, kind: "booked" });
    if (!result.ok) return;

    const booking = await prisma.listingBooking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(booking).toMatchObject({
      status: "CONFIRMED",
      paymentStatus: "PAID_VIA_CHANNEL",
      channel: "REZDY",
      externalReference: "R1001",
      totalCents: 46500,
      commissionCents: 9300,
      conservationCents: 2325,
      operatorNetCents: 37200,
      guests: 2,
    });
    expect((booking.lines as { label: string; amountCents: number }[]).at(-1)).toMatchObject({ label: "Taxes and fees", amountCents: 700 });

    const order = sim.orders.get("R1001")!;
    expect(order.status).toBe("CONFIRMED");
    expect(order.resellerReference).toBe(booking.reference);
    const sent = sim.calls.find((c) => c.method === "createBooking")!.request as { creditCard: unknown; sendNotifications: boolean; fields: unknown[] };
    expect(sent.creditCard).toEqual({ cardToken: "tok_visa" });
    expect(sent.sendNotifications).toBe(false);
    expect(sent.fields).toEqual(expect.arrayContaining([{ label: "Country", value: "AU" }, { label: "Mobile", value: "+61412345678" }]));
  });

  it("sells add-ons: chosen quantities, and per-guest ones sized to the party", async () => {
    const reef = await trip("PRR001");
    const result = await reserveRezdy({
      listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 2 },
      extras: { "Underwater camera hire": 2, "Hotel pickup": 1, "Snorkel safari": 0 },
      lead, source: "ONLINE", cardToken: "tok_visa", expectedTotalCents: 57500, now: NOW,
    }, reef, { api: sim.api, payments: null });
    expect(result).toMatchObject({ ok: true, kind: "booked" });
    const sent = sim.calls.find((c) => c.method === "createBooking")!.request as { items: { extras: unknown }[] };
    expect(sent.items[0].extras).toEqual([{ name: "Underwater camera hire", quantity: 2 }, { name: "Hotel pickup", quantity: 2 }]);
    const booking = await prisma.listingBooking.findFirstOrThrow();
    expect(booking.totalCents).toBe(57500);
    expect((booking.lines as { rateId: string; quantity: number }[]).filter((l) => l.rateId.startsWith("extra:")).map((l) => [l.rateId, l.quantity]))
      .toEqual([["extra:Underwater camera hire", 2], ["extra:Hotel pickup", 2]]);

    const unknown = await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, extras: { Jetski: 1 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW }, reef, { api: sim.api, payments: null });
    expect(unknown).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("never tells a charged traveller nothing happened when Bluepass fails to file the booking", async () => {
    const reef = await trip("PRR001");
    // An older record already holds the order number Rezdy is about to issue.
    const other = await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW }, reef, { api: sim.api, payments: null });
    if (!other.ok) throw new Error(other.reason);
    await prisma.listingBooking.update({ where: { id: other.booking.id }, data: { externalReference: "R1002" } });

    const result = await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW }, reef, { api: sim.api, payments: null });
    expect(result).toMatchObject({ ok: false, code: "CHANNEL" });
    expect(result.ok ? "" : result.reason).toMatch(/You are booked with Reef Runner Charters \(their reference R1002\).*do not book again/);
    expect(await prisma.listingBookingEvent.count({ where: { type: "rezdy_record_failed" } })).toBe(1);
  });

  it("refuses a changed price before the card is touched", async () => {
    const reef = await trip("PRR001");
    const result = await reserveRezdy({
      listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 2 }, lead, source: "ONLINE", cardToken: "tok_visa", expectedTotalCents: 45800, now: NOW,
    }, reef, { api: sim.api, payments: null });
    expect(result).toMatchObject({ ok: false, code: "PRICE_CHANGED", totalCents: 46500 });
    expect(sim.calls.some((c) => c.method === "createBooking")).toBe(false);
    expect(await prisma.listingBooking.count()).toBe(0);
  });

  it("refuses a full session before the card is touched", async () => {
    const reef = await trip("PRR001");
    sim.supplier.setSeats("PRR001", REEF_AT, 1);
    const result = await reserveRezdy({
      listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 2 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW,
    }, reef, { api: sim.api, payments: null });
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(result.ok ? "" : result.reason).toMatch(/Only 1 seat left/);
    expect(sim.calls.some((c) => c.method === "createBooking")).toBe(false);
  });

  it("says plainly when the card is declined, and keeps no seats", async () => {
    const reef = await trip("PRR001");
    const result = await reserveRezdy({
      listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, lead, source: "ONLINE", cardToken: "tok_chargeDeclined", now: NOW,
    }, reef, { api: sim.api, payments: null });
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_FAILED" });
    expect(await prisma.listingBooking.findFirstOrThrow()).toMatchObject({ status: "EXPIRED" });
  });

  it("needs a card: an agent without a browser sends the traveller to the booking page instead", async () => {
    const reef = await trip("PRR001");
    const result = await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, lead, source: "KAI", now: NOW }, reef, { api: sim.api, payments: null });
    expect(result).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("follows a cancellation made in Rezdy: refunded by Rezdy, told by Bluepass", async () => {
    const reef = await trip("PRR001");
    const booked = await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 2 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW }, reef, { api: sim.api, payments: null });
    if (!booked.ok) throw new Error(booked.reason);
    sim.supplier.cancel("R1001");

    const { payments, calls } = fakePayments();
    await reconcileRezdyBookings(new Date(), sim.api, payments);
    const booking = await prisma.listingBooking.findUniqueOrThrow({ where: { id: booked.booking.id } });
    expect(booking).toMatchObject({ status: "CANCELLED", cancelledBy: "rezdy", paymentStatus: "REFUNDED", refundedCents: 46500, conservationCents: 0 });
    expect(calls.filter((c) => c.kind === "refund")).toHaveLength(0); // Rezdy refunds an automated payment itself
    expect(await prisma.railsNotification.count({ where: { bookingId: booking.id, kind: "booking_cancelled" } })).toBeGreaterThan(0);
  });

  it("follows a booking moved in Rezdy, and tells the guest the new time", async () => {
    const reef = await trip("PRR001");
    const booked = await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW }, reef, { api: sim.api, payments: null });
    if (!booked.ok) throw new Error(booked.reason);
    sim.supplier.move("R1001", "2026-11-03 07:30:00");
    await reconcileRezdyBookings(new Date(), sim.api, null);
    const booking = await prisma.listingBooking.findUniqueOrThrow({ where: { id: booked.booking.id } });
    expect(booking.departsAt.toISOString()).toBe(zonedTimeToUtc("2026-11-03", "07:30", ZONE).toISOString());
    expect(await prisma.railsNotification.count({ where: { bookingId: booking.id, kind: "booking_moved" } })).toBeGreaterThan(0);
  });

  it("an operator cancelling on Bluepass cancels in Rezdy first, and Rezdy does the refund", async () => {
    const reef = await trip("PRR001");
    const booked = await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW }, reef, { api: sim.api, payments: null });
    if (!booked.ok) throw new Error(booked.reason);
    const { payments, calls } = fakePayments();
    const result = await cancelBooking({ bookingId: booked.booking.id, operatorProfileId, actor: "op@example.test", reason: "Weather" }, payments);
    expect(result).toMatchObject({ ok: true, refundedCents: 23600 });
    expect(sim.orders.get("R1001")!.status).toBe("CANCELLED");
    expect(calls.filter((c) => c.kind === "refund")).toHaveLength(0);
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: booked.booking.id } })).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED" });
  });
});

describe("full payment to agent: Bluepass takes the money", () => {
  it("holds the seats in Rezdy while the traveller pays, then confirms with the payment recorded", async () => {
    const sail = await trip("PRR002");
    const { payments, calls } = fakePayments();
    const result = await reserveRezdy(
      { listingId: sail.listing.id, departsAt: SAIL_AT, quantities: { Adult: 2, Child: 1 }, lead, source: "ONLINE", now: NOW },
      sail, { api: sim.api, payments },
      { success: () => "https://bluepass.test/ok", cancel: () => "https://bluepass.test/back" },
    );
    expect(result).toMatchObject({ ok: true, kind: "checkout", checkoutUrl: "https://checkout.stripe.test/1" });
    if (!result.ok) return;
    expect(sim.orders.get("R1001")!.status).toBe("PROCESSING");
    expect(sim.sessionsFor("PRR002").find((s) => s.startTimeLocal === "2026-11-02 17:00:00")!.seatsAvailable).toBe(9);
    expect(calls.find((c) => c.kind === "checkout")).toMatchObject({ currency: "AUD" });

    const outcome = await confirmRezdyPayment({ bookingId: result.booking.id, sessionId: "cs_test_1", paymentIntentId: "pi_1", amountTotal: 24700, currency: "aud", now: NOW }, payments, sim.api);
    expect(outcome).toBe("confirmed");
    const order = sim.orders.get("R1001")!;
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments).toEqual([expect.objectContaining({ type: "CREDITCARD", amount: 247, recipient: "RESELLER" })]);
    const booking = await prisma.listingBooking.findUniqueOrThrow({ where: { id: result.booking.id } });
    expect(booking).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID", stripePaymentIntentId: "pi_1", stripeChargeId: "ch_for_pi_1", commissionCents: 3705, operatorNetCents: 20995 });

    // After the trip, the operator is paid the fare less the commission Rezdy reported.
    await prisma.operatorProfile.update({ where: { id: operatorProfileId }, data: { payoutMethod: "STRIPE_CONNECT", stripeConnectAccountId: "acct_reef", stripePayoutsEnabled: true } });
    const run = await settleNativeBookings({ payments, now: new Date(SAIL_AT.getTime() + 2 * 86_400_000) });
    expect(run.settled).toBe(1);
    expect(calls.find((c) => c.kind === "transfer")).toMatchObject({ amountCents: 20995, destination: "acct_reef", sourceTransaction: "ch_for_pi_1" });

    // Stripe retries its webhook: nothing changes the second time.
    expect(await confirmRezdyPayment({ bookingId: result.booking.id, sessionId: "cs_test_1", paymentIntentId: "pi_1", amountTotal: 24700, currency: "aud", now: NOW }, payments, sim.api)).toBe("already_confirmed");
    expect(sim.calls.filter((c) => c.method === "updateBooking")).toHaveLength(1);
  });

  it("never pays out a booking Rezdy charged: Rezdy pays the operator itself", async () => {
    const reef = await trip("PRR001");
    await reserveRezdy({ listingId: reef.listing.id, departsAt: REEF_AT, quantities: { Adult: 1 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW }, reef, { api: sim.api, payments: null });
    await prisma.operatorProfile.update({ where: { id: operatorProfileId }, data: { payoutMethod: "STRIPE_CONNECT", stripeConnectAccountId: "acct_reef", stripePayoutsEnabled: true } });
    const { payments } = fakePayments();
    expect(await settleNativeBookings({ payments, now: new Date(REEF_AT.getTime() + 2 * 86_400_000) })).toMatchObject({ settled: 0 });
  });

  it("gives the held seats back in Rezdy when the checkout is abandoned", async () => {
    const sail = await trip("PRR002");
    const { payments } = fakePayments();
    const result = await reserveRezdy({ listingId: sail.listing.id, departsAt: SAIL_AT, quantities: { Adult: 2 }, lead, source: "ONLINE", now: NOW }, sail, { api: sim.api, payments });
    if (!result.ok) throw new Error(result.reason);
    await expireCheckout(result.booking.id);
    expect(sim.orders.get("R1001")!.status).toBe("CANCELLED");
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: result.booking.id } })).toMatchObject({ status: "EXPIRED" });
    expect(sim.sessionsFor("PRR002").find((s) => s.startTimeLocal === "2026-11-02 17:00:00")!.seatsAvailable).toBe(12);
  });

  it("refunds through Stripe when the operator cancels in Rezdy", async () => {
    const sail = await trip("PRR002");
    const { payments, calls } = fakePayments();
    const result = await reserveRezdy({ listingId: sail.listing.id, departsAt: SAIL_AT, quantities: { Adult: 1 }, lead, source: "ONLINE", now: NOW }, sail, { api: sim.api, payments });
    if (!result.ok) throw new Error(result.reason);
    await confirmRezdyPayment({ bookingId: result.booking.id, sessionId: "cs_test_1", paymentIntentId: "pi_9", amountTotal: 9900, currency: "aud", now: NOW }, payments, sim.api);
    sim.supplier.cancel("R1001");
    await reconcileRezdyBookings(new Date(), sim.api, payments);
    expect(calls.filter((c) => c.kind === "refund")).toEqual([expect.objectContaining({ paymentIntentId: "pi_9", amountCents: 9900 })]);
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: result.booking.id } })).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED", refundedCents: 9900 });
  });
});

describe("trips the operator accepts by hand", () => {
  it("waits for the operator in Rezdy, then confirms", async () => {
    const charter = await trip("PRR003");
    const result = await reserveRezdy(
      { listingId: charter.listing.id, departsAt: CHARTER_AT, quantities: { "Charter up to 10": 1 }, lead, source: "ONLINE", cardToken: "tok_visa", now: NOW },
      charter, { api: sim.api, payments: null },
    );
    expect(result).toMatchObject({ ok: true, kind: "booked" });
    if (!result.ok) return;
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: result.booking.id } })).toMatchObject({ status: "REQUESTED" });
    expect(await prisma.railsNotification.count({ where: { bookingId: result.booking.id, kind: "booking_requested" } })).toBe(1);

    sim.supplier.confirm("R1001");
    await reconcileRezdyBookings(new Date(), sim.api, null);
    expect(await prisma.listingBooking.findUniqueOrThrow({ where: { id: result.booking.id } })).toMatchObject({ status: "CONFIRMED" });
  });
});
