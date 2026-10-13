import { randomBytes } from "node:crypto";
import { Prisma, type ListingBooking } from "@prisma/client";
import { DEFAULT_COUNTRY_ISO, findCountryByIso } from "@/lib/countries";
import { prisma } from "@/lib/db/prisma";
import { parsePhoneInput, toE164 } from "@/lib/phone";
import {
  blackoutOn,
  busyFor,
  overlapsBusy,
  blackoutReason,
  countTaken,
  dayBounds,
  emptyMisses,
  evaluateDeparture,
  localDateInZone,
  priceParty,
  refusalReason,
  scheduledDepartures,
  type DepartureState,
  type PricedLine,
  type ScheduleRule,
} from "@/lib/services/operators/listing-availability";
import { markDepartureChanged } from "@/lib/services/rails/calendar-events";
import { whatsappDigits } from "@/lib/services/rails/links";
import {
  notifyBookingCancelled,
  notifyBookingConfirmed,
  resendTravellerConfirmation,
} from "@/lib/services/rails/notify";
import { splitOnlineBooking } from "@/lib/services/rails/money";
import type { RailsPayments } from "@/lib/services/rails/payments";
import { newBookingReference } from "@/lib/services/rails/reference";

/**
 * The write side of the native rails: taking seats, confirming them once paid,
 * giving them back.
 *
 * Every write that changes how many seats a departure has left runs inside
 * `underDepartureLock`, a Postgres advisory lock keyed on the listing and the
 * departure instant. Two travellers paying for the last seat at the same moment are
 * serialised there: the second one re-reads capacity after the first has taken it
 * and is refused with a reason, instead of both being charged for one seat. The lock
 * is per departure, so it never makes one trip's bookings wait on another's.
 *
 * Money moves (refunds) happen before the database records them, never after. A
 * refund that fails leaves the booking exactly as it was, so the operator can try
 * again; the reverse order would mark a traveller refunded who never was.
 */

type Tx = Prisma.TransactionClient;

/** Long enough to pay on a phone with a card in another room. Stripe's own floor is 30 minutes. */
export const CHECKOUT_MINUTES = 31;
/** The seats outlast the payment page by a little, so a payment completed in its last second still finds them. */
export const HOLD_MINUTES = CHECKOUT_MINUTES + 3;

export type BookingFailure = { ok: false; reason: string; code: BookingFailureCode };
export type BookingFailureCode =
  | "NOT_FOUND"
  | "NOT_BOOKABLE"
  | "INVALID"
  | "UNAVAILABLE"
  | "PAYMENTS_OFF"
  | "PAYMENT_FAILED"
  | "ALREADY_DONE"
  /** The operator's system quotes a different total than the page showed. Nothing was charged. */
  | "PRICE_CHANGED"
  /** The operator's booking system refused or did not answer. */
  | "CHANNEL";

export function fail(code: BookingFailureCode, reason: string): BookingFailure {
  return { ok: false, code, reason };
}

export async function underDepartureLock<T>(listingId: string, departsAt: Date, fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(
    async (tx) => {
      const key = `${listingId}|${departsAt.toISOString()}`;
      // executeRaw rather than queryRaw: the lock function returns void, which queryRaw cannot decode.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

type Located = { schedule: ScheduleRule; localDate: string; localTime: string };

/**
 * Finds the schedule pattern a departure instant belongs to. A departure that no
 * active pattern produces does not exist, whatever a stale page might submit.
 */
async function locateDeparture(db: Tx | typeof prisma, listingId: string, departsAt: Date): Promise<Located | null> {
  const schedules = await db.listingSchedule.findMany({ where: { listingId, active: true } });
  for (const schedule of schedules) {
    const localDate = localDateInZone(departsAt, schedule.timezone);
    const match = scheduledDepartures([schedule], localDate)
      .find((d) => d.departsAt.getTime() === departsAt.getTime());
    if (match) return { schedule, localDate, localTime: match.localTime };
  }
  return null;
}

/**
 * The live state of one departure for one party, read inside the lock.
 * `excludeBookingId` leaves a booking's own hold out of the count, for re-seating it.
 */
async function departureState(
  tx: Tx,
  listingId: string,
  located: Located,
  departsAt: Date,
  opts: { guests: number; now: Date; ignoreWindow: boolean; excludeBookingId?: string },
): Promise<{ ok: true; state: DepartureState } | BookingFailure> {
  const { start } = dayBounds(located.localDate);
  const blackouts = await tx.listingBlackout.findMany({
    where: { listingId, startDate: { lte: start }, endDate: { gte: start } },
    select: { startDate: true, endDate: true, reason: true },
  });
  const blackout = blackoutOn(blackouts, located.localDate);
  if (blackout) return fail("UNAVAILABLE", blackoutReason(blackout));

  const [override, holds, busy] = await Promise.all([
    tx.listingDepartureOverride.findUnique({ where: { listingId_departsAt: { listingId, departsAt } } }),
    tx.listingSeatHold.findMany({
      where: { listingId, departsAt },
      select: { seats: true, confirmed: true, expiresAt: true, bookingId: true },
    }),
    busyFor(listingId, departsAt, new Date(departsAt.getTime() + 86_400_000), tx),
  ]);
  const counted = opts.excludeBookingId ? holds.filter((h) => h.bookingId !== opts.excludeBookingId) : holds;

  const state = evaluateDeparture(
    { schedule: located.schedule, departsAt, localTime: located.localTime },
    {
      taken: countTaken(counted, opts.now),
      override,
      guests: opts.guests,
      now: opts.now,
      ignoreWindow: opts.ignoreWindow,
      busy: overlapsBusy(departsAt, busy.durationMinutes, busy.intervals),
    },
  );
  if (state.block) {
    const misses = emptyMisses();
    misses[state.block] = 1;
    return fail("UNAVAILABLE", refusalReason(misses, opts.guests, [located.schedule]));
  }
  return { ok: true, state };
}

async function uniqueReference(tx: Tx) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const reference = newBookingReference();
    const taken = await tx.listingBooking.findUnique({ where: { reference }, select: { id: true } });
    if (!taken) return reference;
  }
  throw new Error("Could not allocate a booking reference.");
}

export function event(tx: Tx | typeof prisma, bookingId: string, type: string, actor: string, message?: string, payload?: Prisma.InputJsonValue) {
  return tx.listingBookingEvent.create({ data: { bookingId, type, actor, message, payload } });
}

/** The key to a guest's own booking page: random, never derived from the booking. */
export function newGuestToken() {
  return randomBytes(18).toString("base64url");
}

/**
 * A phone number in the international form WhatsApp needs. A number typed with its
 * country code is kept as given; a local one ("0412 345 678") is read in the
 * operator's country, which is where a phone booking's caller almost always is.
 */
export function normalisePhone(raw: string | null, countryIso?: string | null): string | null {
  if (!raw) return null;
  const digits = whatsappDigits(raw);
  if (digits) return `+${digits}`;
  const country = findCountryByIso(countryIso) ?? findCountryByIso(DEFAULT_COUNTRY_ISO);
  if (!country || !/^\s*0/.test(raw)) return raw;
  const parsed = parsePhoneInput(raw, country);
  return toE164(parsed.country, parsed.national) || raw;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

export type LeadGuest = { name: string; email?: string | null; phone?: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanLead(lead: LeadGuest, emailRequired: boolean): { ok: true; lead: Required<LeadGuest> } | BookingFailure {
  const name = lead.name?.trim() ?? "";
  const email = lead.email?.trim().toLowerCase() || null;
  const phone = lead.phone?.trim() || null;
  if (name.length < 2 || name.length > 120) return fail("INVALID", "Add the lead guest's name.");
  if (emailRequired && !email) return fail("INVALID", "Add an email address for the confirmation.");
  if (email && (!EMAIL.test(email) || email.length > 200)) return fail("INVALID", "That email address does not look right.");
  if (phone && phone.length > 40) return fail("INVALID", "That phone number is too long.");
  return { ok: true, lead: { name, email, phone } };
}

export function cleanNotes(notes?: string | null) {
  const trimmed = notes?.trim();
  return trimmed ? trimmed.slice(0, 1000) : null;
}

// ---------------------------------------------------------------------------
// Online: reserve, pay, confirm
// ---------------------------------------------------------------------------

export type ReserveInput = {
  listingId: string;
  departsAt: Date;
  quantities: Record<string, number>;
  guests?: number;
  lead: LeadGuest;
  notes?: string | null;
  referralCode?: string | null;
  /** The guest ticked "send my booking on WhatsApp". Kept only with a number WhatsApp can reach. */
  whatsappOptIn?: boolean;
  source: "ONLINE" | "KAI";
  now?: Date;
};

/**
 * Holds seats for a traveller while they pay. The price is computed here from the
 * operator's rates, never accepted from the request: the page shows a total, but the
 * total charged is the one this function works out.
 */
export async function reserveSeats(input: ReserveInput): Promise<{ ok: true; booking: ListingBooking } | BookingFailure> {
  const now = input.now ?? new Date();
  const lead = cleanLead(input.lead, true);
  if (!lead.ok) return lead;

  const listing = await prisma.operatorListing.findUnique({
    where: { id: input.listingId },
    include: { rates: true, operatorProfile: { select: { id: true, status: true } } },
  });
  if (!listing || listing.status !== "LIVE") return fail("NOT_BOOKABLE", "This trip is not taking bookings right now.");

  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

  return underDepartureLock(input.listingId, input.departsAt, async (tx) => {
    const located = await locateDeparture(tx, input.listingId, input.departsAt);
    if (!located) return fail("UNAVAILABLE", "That departure is no longer on the schedule. Pick another time.");

    const priced = priceParty(listing.rates, located.localDate, { quantities: input.quantities, guests: input.guests });
    if (!priced.ok) return fail("INVALID", priced.reason);
    if (priced.totalCents < 100) return fail("NOT_BOOKABLE", "This trip has no price set for that date yet.");

    const live = await departureState(tx, input.listingId, located, input.departsAt, {
      guests: priced.guests, now, ignoreWindow: false,
    });
    if (!live.ok) return live;

    const booking = await tx.listingBooking.create({
      data: {
        reference: await uniqueReference(tx),
        listingId: listing.id,
        operatorProfileId: listing.operatorProfileId,
        scheduleId: located.schedule.id,
        departsAt: input.departsAt,
        timezone: located.schedule.timezone,
        guests: priced.guests,
        lines: priced.lines as unknown as Prisma.InputJsonValue,
        totalCents: priced.totalCents,
        currency: priced.currency,
        status: "PENDING_PAYMENT",
        source: input.source,
        paymentStatus: "UNPAID",
        leadName: lead.lead.name,
        leadEmail: lead.lead.email,
        leadPhone: normalisePhone(lead.lead.phone),
        notes: cleanNotes(input.notes),
        referralCode: input.referralCode?.trim().slice(0, 64) || null,
        whatsappOptIn: Boolean(input.whatsappOptIn && whatsappDigits(lead.lead.phone)),
        guestToken: newGuestToken(),
        expiresAt,
      },
    });
    await tx.listingSeatHold.create({
      data: { listingId: listing.id, departsAt: input.departsAt, seats: priced.guests, expiresAt, bookingId: booking.id },
    });
    await event(tx, booking.id, "reserved", input.source === "KAI" ? "kai" : "traveller",
      `${priced.guests} seats held until ${expiresAt.toISOString()}`);
    return { ok: true as const, booking };
  });
}

/**
 * Reserve, then open a Stripe payment page for exactly what was reserved. If the
 * payment page cannot be opened, the seats go straight back rather than sitting
 * held for half an hour against a checkout nobody can reach.
 */
export async function reserveAndCheckout(
  input: ReserveInput,
  payments: RailsPayments | null,
  urls: { success: (booking: ListingBooking) => string; cancel: (booking: ListingBooking) => string },
): Promise<{ ok: true; booking: ListingBooking; checkoutUrl: string } | BookingFailure> {
  if (!payments) return fail("PAYMENTS_OFF", "Online payment is not switched on for this trip yet.");

  const reserved = await reserveSeats(input);
  if (!reserved.ok) return reserved;
  const { booking } = reserved;

  const listing = await prisma.operatorListing.findUniqueOrThrow({
    where: { id: booking.listingId },
    select: { title: true, operatorProfile: { select: { companyName: true } } },
  });

  try {
    const session = await payments.createCheckout({
      bookingId: booking.id,
      reference: booking.reference,
      currency: booking.currency,
      lines: booking.lines as unknown as PricedLine[],
      productName: listing.title,
      description: `${booking.reference} · ${listing.operatorProfile.companyName ?? "Bluepass operator"}`,
      customerEmail: booking.leadEmail ?? undefined,
      successUrl: urls.success(booking),
      cancelUrl: urls.cancel(booking),
      expiresAt: new Date((input.now ?? new Date()).getTime() + CHECKOUT_MINUTES * 60_000),
    });
    const updated = await prisma.listingBooking.update({
      where: { id: booking.id },
      data: { stripeCheckoutSessionId: session.id },
    });
    return { ok: true, booking: updated, checkoutUrl: session.url };
  } catch (error) {
    await releaseBooking(booking.id, "EXPIRED", "system", "The payment page could not be opened.");
    console.error("rails.checkout_failed", { reference: booking.reference, error: error instanceof Error ? error.message : String(error) });
    return fail("PAYMENT_FAILED", "We could not open the payment page. Nothing was charged; please try again.");
  }
}

/** Ends an unpaid booking and gives its seats back. */
async function releaseBooking(bookingId: string, status: "EXPIRED" | "CANCELLED", actor: string, reason: string) {
  await prisma.$transaction([
    prisma.listingSeatHold.deleteMany({ where: { bookingId } }),
    prisma.listingBooking.update({
      where: { id: bookingId },
      data: {
        status,
        expiresAt: null,
        ...(status === "CANCELLED" ? { cancelledAt: new Date(), cancelledBy: actor, cancelReason: reason } : {}),
      },
    }),
    prisma.listingBookingEvent.create({ data: { bookingId, type: status.toLowerCase(), actor, message: reason } }),
  ]);
}

export type PaymentConfirmation = {
  bookingId: string;
  sessionId: string;
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
  now?: Date;
};

export type ConfirmOutcome =
  | "confirmed"
  | "already_confirmed"
  | "refunded_cancelled"
  | "refunded_full"
  | "unknown";

/**
 * Stripe says a checkout was paid. Idempotent: Stripe retries webhooks and may
 * deliver this more than once, and the second delivery must change nothing.
 *
 * The awkward cases are the reason this function is long:
 * - the traveller paid after their hold lapsed. If the seats are still there they
 *   get them; if someone else has since taken them, they get every cent back.
 * - the operator cancelled while the traveller was on the payment page. The money
 *   goes straight back, because there is no booking for it to pay for.
 */
export async function confirmPayment(input: PaymentConfirmation, payments: RailsPayments | null): Promise<ConfirmOutcome> {
  const now = input.now ?? new Date();
  const booking = await prisma.listingBooking.findUnique({ where: { id: input.bookingId } });
  if (!booking) return "unknown";
  if (booking.channel === "REZDY") {
    // Loaded on demand: the Rezdy engine builds on this module, not the other way round.
    const { confirmRezdyPayment } = await import("@/lib/services/channels/rezdy/booking");
    return confirmRezdyPayment(input, payments);
  }
  if (booking.status === "CONFIRMED" && booking.paymentStatus === "PAID") return "already_confirmed";
  if (booking.paymentStatus === "REFUNDED") return "already_confirmed";

  const paidCents = input.amountTotal ?? booking.totalCents;

  if (booking.status === "CANCELLED") {
    await refundWholePayment(booking, input, paidCents, payments, "The booking was cancelled before the payment completed.");
    return "refunded_cancelled";
  }

  const located = await locateDeparture(prisma, booking.listingId, booking.departsAt);

  const seated = await underDepartureLock(booking.listingId, booking.departsAt, async (tx) => {
    const hold = await tx.listingSeatHold.findFirst({ where: { bookingId: booking.id } });
    const holdIsLive = hold && (hold.confirmed || !hold.expiresAt || hold.expiresAt > now);

    if (!holdIsLive) {
      // The seats were let go. Take them again if they are still free; the traveller has
      // already paid, so the booking window no longer applies, only capacity.
      if (!located) return false;
      const live = await departureState(tx, booking.listingId, located, booking.departsAt, {
        guests: booking.guests, now, ignoreWindow: true, excludeBookingId: booking.id,
      });
      if (!live.ok) return false;
      await tx.listingSeatHold.deleteMany({ where: { bookingId: booking.id } });
      await tx.listingSeatHold.create({
        data: { listingId: booking.listingId, departsAt: booking.departsAt, seats: booking.guests, confirmed: true, bookingId: booking.id },
      });
    } else {
      await tx.listingSeatHold.update({ where: { id: hold.id }, data: { confirmed: true, expiresAt: null } });
    }

    const split = splitOnlineBooking(booking.totalCents);
    await tx.listingBooking.update({
      where: { id: booking.id },
      data: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
        paidAt: now,
        expiresAt: null,
        stripeCheckoutSessionId: input.sessionId,
        stripePaymentIntentId: input.paymentIntentId,
        conservationCents: split.conservationCents,
        operatorNetCents: split.operatorNetCents,
      },
    });
    await event(tx, booking.id, "paid", "stripe", undefined,
      paidCents !== booking.totalCents ? { warning: "amount_mismatch", paidCents, expectedCents: booking.totalCents } : undefined);
    return true;
  });

  if (!seated) {
    await prisma.listingBooking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED", cancelledAt: now, cancelledBy: "system",
        cancelReason: "The payment arrived after the seats were released, and the departure had filled.",
      },
    });
    const fresh = await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } });
    await refundWholePayment(fresh, input, paidCents, payments, "The departure filled before your payment arrived.");
    return "refunded_full";
  }

  if (payments && input.paymentIntentId) {
    try {
      const chargeId = await payments.chargeIdFor(input.paymentIntentId);
      if (chargeId) await prisma.listingBooking.update({ where: { id: booking.id }, data: { stripeChargeId: chargeId } });
    } catch {
      // Only needed to tie the payout to the charge; settlement can look it up again.
    }
  }

  await markDepartureChanged(booking.operatorProfileId, booking.listingId, booking.departsAt);
  await notifyBookingConfirmed(booking.id);
  return "confirmed";
}

export async function refundWholePayment(
  booking: ListingBooking,
  input: PaymentConfirmation,
  paidCents: number,
  payments: RailsPayments | null,
  reason: string,
) {
  if (!payments || !input.paymentIntentId) {
    await event(prisma, booking.id, "refund_needed", "system", "Paid after cancellation, and no payment provider to refund through.");
    return;
  }
  const refund = await payments.refund({
    paymentIntentId: input.paymentIntentId,
    amountCents: paidCents,
    idempotencyKey: `rails-refund-late-${booking.id}`,
    bookingReference: booking.reference,
  });
  await prisma.listingBooking.update({
    where: { id: booking.id },
    data: {
      paymentStatus: "REFUNDED",
      refundedCents: paidCents,
      stripePaymentIntentId: input.paymentIntentId,
      stripeCheckoutSessionId: input.sessionId,
    },
  });
  await event(prisma, booking.id, "refunded", "system", reason, { refundId: refund.id, amountCents: paidCents });
  await notifyBookingCancelled(booking.id, { reason, refundedCents: paidCents });
}

/** A checkout Stripe has given up on. The seats go back now rather than when the hold lapses. */
export async function expireCheckout(bookingId: string) {
  const booking = await prisma.listingBooking.findUnique({ where: { id: bookingId }, select: { status: true, channel: true } });
  if (booking?.status !== "PENDING_PAYMENT") return;
  if (booking.channel === "REZDY") {
    const { releaseRezdyHold } = await import("@/lib/services/channels/rezdy/booking");
    await releaseRezdyHold(bookingId, "The payment page expired before it was used.");
    return;
  }
  await releaseBooking(bookingId, "EXPIRED", "stripe", "The payment page expired before it was used.");
}

/** Marks lapsed holds as expired. Their seats are already free; this tidies the record. */
export async function expireLapsedBookings(now = new Date()) {
  // Rezdy holds and Rezdy charges are let go by the Rezdy engine, which has to tell Rezdy
  // (and, for a charge whose answer was lost, ask it first).
  const result = await prisma.listingBooking.updateMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lt: now }, channel: "NATIVE" },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Operator: phone and walk-up bookings
// ---------------------------------------------------------------------------

export type OperatorBookingInput = {
  operatorProfileId: string;
  listingId: string;
  departsAt: Date;
  quantities: Record<string, number>;
  guests?: number;
  /** What the operator actually charged, when it differs from the rate card. */
  totalCents?: number | null;
  lead: LeadGuest;
  notes?: string | null;
  paid: boolean;
  /** Email the guest their confirmation. */
  sendConfirmation: boolean;
  /** WhatsApp the guest their confirmation and reminder. The operator asked them on the phone. */
  sendWhatsApp?: boolean;
  /** Reads a local number ("0412...") in this country. The operator's own, usually. */
  phoneCountry?: string | null;
  actorEmail: string;
  now?: Date;
};

/**
 * A booking the operator took themselves. It exists so the boat cannot be sold twice:
 * a seat sold over the phone has to come off what the booking page offers, or the
 * calendar is wrong the moment the operator answers a call.
 *
 * Bluepass handled none of this money, so it carries no 5% and no fee.
 */
export async function createOperatorBooking(input: OperatorBookingInput): Promise<{ ok: true; booking: ListingBooking } | BookingFailure> {
  const now = input.now ?? new Date();
  const lead = cleanLead(input.lead, false);
  if (!lead.ok) return lead;

  const listing = await prisma.operatorListing.findUnique({ where: { id: input.listingId }, include: { rates: true } });
  if (!listing || listing.operatorProfileId !== input.operatorProfileId) return fail("NOT_FOUND", "That trip is not one of yours.");
  if (listing.channel !== "NATIVE") {
    return fail("INVALID", `This trip's seats live in ${listing.channel === "REZDY" ? "Rezdy" : "FareHarbor"}. Take the booking there, so the seat comes off every channel at once.`);
  }

  const result = await underDepartureLock(input.listingId, input.departsAt, async (tx) => {
    const located = await locateDeparture(tx, input.listingId, input.departsAt);
    if (!located) return fail("UNAVAILABLE", "That departure is not on your schedule.");

    const chosen = Object.values(input.quantities).some((q) => Number(q) > 0);
    let lines: PricedLine[];
    let guests: number;
    let totalCents: number;
    let currency = listing.currency;

    if (chosen) {
      const priced = priceParty(listing.rates, located.localDate, { quantities: input.quantities, guests: input.guests });
      if (!priced.ok) return fail("INVALID", priced.reason);
      ({ lines, guests, totalCents, currency } = priced);
    } else {
      guests = Math.floor(Number(input.guests ?? 0));
      if (!(guests >= 1 && guests <= 500)) return fail("INVALID", "Add how many guests are coming.");
      lines = [{ rateId: "manual", label: "Guests", amountCents: 0, quantity: guests, perGuest: true }];
      totalCents = 0;
    }

    const override = input.totalCents;
    if (override !== null && override !== undefined) {
      if (!Number.isInteger(override) || override < 0 || override > 100_000_000) return fail("INVALID", "That total does not look right.");
      totalCents = override;
    }

    const live = await departureState(tx, input.listingId, located, input.departsAt, { guests, now, ignoreWindow: true });
    if (!live.ok) return live;

    const booking = await tx.listingBooking.create({
      data: {
        reference: await uniqueReference(tx),
        listingId: listing.id,
        operatorProfileId: input.operatorProfileId,
        scheduleId: located.schedule.id,
        departsAt: input.departsAt,
        timezone: located.schedule.timezone,
        guests,
        lines: lines as unknown as Prisma.InputJsonValue,
        totalCents,
        currency,
        status: "CONFIRMED",
        source: "OPERATOR",
        paymentStatus: input.paid ? "PAID_TO_OPERATOR" : "UNPAID",
        leadName: lead.lead.name,
        leadEmail: lead.lead.email,
        leadPhone: normalisePhone(lead.lead.phone, input.phoneCountry),
        notes: cleanNotes(input.notes),
        whatsappOptIn: Boolean(input.sendWhatsApp && whatsappDigits(normalisePhone(lead.lead.phone, input.phoneCountry))),
        guestToken: newGuestToken(),
      },
    });
    await tx.listingSeatHold.create({
      data: { listingId: listing.id, departsAt: input.departsAt, seats: guests, confirmed: true, bookingId: booking.id },
    });
    await event(tx, booking.id, "created", input.actorEmail, "Entered by the operator");
    return { ok: true as const, booking };
  });

  if (result.ok) {
    await markDepartureChanged(input.operatorProfileId, input.listingId, input.departsAt);
    if (input.sendConfirmation || input.sendWhatsApp) {
      await notifyBookingConfirmed(result.booking.id, {
        operator: false,
        channels: { email: input.sendConfirmation, whatsapp: Boolean(input.sendWhatsApp) },
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Operator: changes to existing bookings and departures
// ---------------------------------------------------------------------------

async function ownedBooking(bookingId: string, operatorProfileId: string) {
  const booking = await prisma.listingBooking.findUnique({ where: { id: bookingId } });
  return booking && booking.operatorProfileId === operatorProfileId ? booking : null;
}

/**
 * Cancels a booking and gives back its seats. A traveller who paid online gets
 * every cent back: when the operator cancels, the traveller did nothing wrong, which
 * is the same rule Kai applies (operator cancellation refunds in full).
 */
export async function cancelBooking(
  input: { bookingId: string; operatorProfileId: string; actor: string; reason: string; now?: Date },
  payments: RailsPayments | null,
): Promise<{ ok: true; refundedCents: number } | BookingFailure> {
  const now = input.now ?? new Date();
  const booking = await ownedBooking(input.bookingId, input.operatorProfileId);
  if (!booking) return fail("NOT_FOUND", "That booking is not one of yours.");
  if (booking.status === "CANCELLED" || booking.status === "EXPIRED") return fail("ALREADY_DONE", "That booking is already cancelled.");
  if (booking.settledAt) {
    return fail("INVALID", "This booking has already been paid out to you, so it cannot be cancelled here. Reply to the payout email and Bluepass will reverse it.");
  }
  const reason = input.reason.trim().slice(0, 300) || "Cancelled by the operator";

  const refundable = booking.paymentStatus === "PAID" || booking.paymentStatus === "PARTIALLY_REFUNDED"
    ? booking.totalCents - booking.refundedCents
    : 0;
  if (refundable > 0 && (!payments || !booking.stripePaymentIntentId)) {
    return fail("PAYMENTS_OFF", "This booking was paid online, and refunds cannot be issued right now. Nothing was changed; try again shortly.");
  }

  // A Rezdy booking is cancelled in Rezdy first. If Rezdy says no, nothing here changes.
  let refundedByChannel = 0;
  if (booking.channel === "REZDY") {
    const { cancelRezdyOrder } = await import("@/lib/services/channels/rezdy/booking");
    const cancelled = await cancelRezdyOrder(booking);
    if (!cancelled.ok) return cancelled;
    if (cancelled.refundedByRezdy) refundedByChannel = booking.totalCents - booking.refundedCents;
  }

  let refundId: string | null = null;
  if (refundable > 0 && payments && booking.stripePaymentIntentId) {
    try {
      const refund = await payments.refund({
        paymentIntentId: booking.stripePaymentIntentId,
        amountCents: refundable,
        idempotencyKey: `rails-refund-${booking.id}-${booking.refundedCents}`,
        bookingReference: booking.reference,
      });
      refundId = refund.id;
    } catch (error) {
      console.error("rails.refund_failed", { reference: booking.reference, error: error instanceof Error ? error.message : String(error) });
      if (booking.channel === "REZDY") {
        // Already cancelled in Rezdy. The Rezdy reconciler sees that within 15 minutes and
        // refunds, records and tells the traveller, exactly as for a cancellation made in Rezdy.
        return fail("PAYMENT_FAILED", "Cancelled in Rezdy, but the refund did not go through yet. Bluepass tries it again automatically within 15 minutes.");
      }
      return fail("PAYMENT_FAILED", "The refund did not go through, so the booking has not been cancelled. Try again in a minute.");
    }
  }

  if (booking.status === "PENDING_PAYMENT" && booking.stripeCheckoutSessionId && payments) {
    await payments.expireCheckout(booking.stripeCheckoutSessionId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.listingSeatHold.deleteMany({ where: { bookingId: booking.id } });
    await tx.listingBooking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy: input.actor,
        cancelReason: reason,
        expiresAt: null,
        ...(refundable + refundedByChannel > 0
          ? {
              paymentStatus: "REFUNDED",
              refundedCents: booking.refundedCents + refundable + refundedByChannel,
              conservationCents: 0,
              operatorNetCents: 0,
            }
          : {}),
      },
    });
    await event(tx, booking.id, "cancelled", input.actor, reason);
    if (refundId) await event(tx, booking.id, "refunded", input.actor, undefined, { refundId, amountCents: refundable });
    if (refundedByChannel) await event(tx, booking.id, "refunded", "rezdy", "Refunded to the card by Rezdy", { amountCents: refundedByChannel });
  });

  await markDepartureChanged(booking.operatorProfileId, booking.listingId, booking.departsAt);
  if (booking.status === "CONFIRMED" || booking.status === "REQUESTED") {
    await notifyBookingCancelled(booking.id, { reason, refundedCents: refundable + refundedByChannel });
  }
  return { ok: true, refundedCents: refundable + refundedByChannel };
}

/**
 * Weather call: the departure does not run. Closes it to new bookings and cancels
 * everyone on it with a full refund, in one go, because the morning a boat cannot
 * go out is the morning an operator has least time to do it one by one.
 */
export async function cancelDeparture(
  input: { listingId: string; departsAt: Date; operatorProfileId: string; actor: string; reason: string; now?: Date },
  payments: RailsPayments | null,
): Promise<{ ok: true; cancelled: number; refundedCents: number; failed: string[] } | BookingFailure> {
  const listing = await prisma.operatorListing.findUnique({ where: { id: input.listingId }, select: { operatorProfileId: true } });
  if (!listing || listing.operatorProfileId !== input.operatorProfileId) return fail("NOT_FOUND", "That trip is not one of yours.");

  const reason = input.reason.trim().slice(0, 300) || "The departure is not running";
  await prisma.listingDepartureOverride.upsert({
    where: { listingId_departsAt: { listingId: input.listingId, departsAt: input.departsAt } },
    create: { listingId: input.listingId, departsAt: input.departsAt, closed: true, note: reason },
    update: { closed: true, note: reason },
  });

  const onBoard = await prisma.listingBooking.findMany({
    where: { listingId: input.listingId, departsAt: input.departsAt, status: { in: ["CONFIRMED", "REQUESTED", "PENDING_PAYMENT"] } },
    select: { id: true, reference: true },
  });

  let cancelled = 0;
  let refundedCents = 0;
  const failed: string[] = [];
  for (const b of onBoard) {
    const r = await cancelBooking({ bookingId: b.id, operatorProfileId: input.operatorProfileId, actor: input.actor, reason, now: input.now }, payments);
    if (r.ok) { cancelled += 1; refundedCents += r.refundedCents; } else failed.push(`${b.reference}: ${r.reason}`);
  }
  return { ok: true, cancelled, refundedCents, failed };
}

/**
 * Closes, reopens or resizes one departure. Capacity can never drop below the
 * seats already sold: the guests on those seats are real people with tickets.
 */
export async function setDepartureOverride(input: {
  listingId: string;
  departsAt: Date;
  operatorProfileId: string;
  closed: boolean;
  capacity: number | null;
  note: string | null;
  now?: Date;
}): Promise<{ ok: true } | BookingFailure> {
  const now = input.now ?? new Date();
  const listing = await prisma.operatorListing.findUnique({ where: { id: input.listingId }, select: { operatorProfileId: true, channel: true } });
  if (!listing || listing.operatorProfileId !== input.operatorProfileId) return fail("NOT_FOUND", "That trip is not one of yours.");

  // A Rezdy or FareHarbor departure's seats live there. Bluepass can stop selling it,
  // which it does at once; its size is changed in the operator's own system.
  if (listing.channel !== "NATIVE") {
    const note = input.note?.trim().slice(0, 300) || null;
    if (!input.closed && !note) {
      await prisma.listingDepartureOverride.deleteMany({ where: { listingId: input.listingId, departsAt: input.departsAt } });
    } else {
      await prisma.listingDepartureOverride.upsert({
        where: { listingId_departsAt: { listingId: input.listingId, departsAt: input.departsAt } },
        create: { listingId: input.listingId, departsAt: input.departsAt, closed: input.closed, note },
        update: { closed: input.closed, note },
      });
    }
    await markDepartureChanged(input.operatorProfileId, input.listingId, input.departsAt);
    return { ok: true as const };
  }

  const result = await underDepartureLock(input.listingId, input.departsAt, async (tx) => {
    const located = await locateDeparture(tx, input.listingId, input.departsAt);
    if (!located) return fail("UNAVAILABLE", "That departure is not on your schedule.");

    if (input.capacity !== null) {
      if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 1000) return fail("INVALID", "Capacity has to be a whole number of seats.");
      const holds = await tx.listingSeatHold.findMany({
        where: { listingId: input.listingId, departsAt: input.departsAt },
        select: { seats: true, confirmed: true, expiresAt: true },
      });
      const taken = countTaken(holds, now);
      if (input.capacity < taken) return fail("INVALID", `${taken} seats are already sold on this departure, so capacity cannot go below that.`);
    }

    const capacity = input.capacity === located.schedule.capacityPerDeparture ? null : input.capacity;
    const note = input.note?.trim().slice(0, 300) || null;
    const key = { listingId_departsAt: { listingId: input.listingId, departsAt: input.departsAt } };

    if (!input.closed && capacity === null && !note) {
      await tx.listingDepartureOverride.deleteMany({ where: { listingId: input.listingId, departsAt: input.departsAt } });
    } else {
      await tx.listingDepartureOverride.upsert({
        where: key,
        create: { listingId: input.listingId, departsAt: input.departsAt, closed: input.closed, capacity, note },
        update: { closed: input.closed, capacity, note },
      });
    }
    return { ok: true as const };
  });
  if (result.ok) await markDepartureChanged(input.operatorProfileId, input.listingId, input.departsAt);
  return result;
}

export async function setCheckedIn(input: { bookingId: string; operatorProfileId: string; checkedIn: boolean; actor: string }) {
  const booking = await ownedBooking(input.bookingId, input.operatorProfileId);
  if (!booking || booking.status !== "CONFIRMED") return fail("NOT_FOUND", "That booking cannot be checked in.");
  await prisma.listingBooking.update({ where: { id: booking.id }, data: { checkedInAt: input.checkedIn ? new Date() : null } });
  await event(prisma, booking.id, input.checkedIn ? "checked_in" : "check_in_undone", input.actor);
  return { ok: true as const };
}

/** For a phone booking marked "to collect": the operator has now been paid on the day. */
export async function markCollected(input: { bookingId: string; operatorProfileId: string; actor: string }) {
  const booking = await ownedBooking(input.bookingId, input.operatorProfileId);
  if (!booking || booking.source !== "OPERATOR" || booking.paymentStatus !== "UNPAID") {
    return fail("INVALID", "Only a booking you took yourself can be marked as paid to you.");
  }
  await prisma.listingBooking.update({ where: { id: booking.id }, data: { paymentStatus: "PAID_TO_OPERATOR" } });
  await event(prisma, booking.id, "collected", input.actor, "Marked as paid to the operator");
  await markDepartureChanged(booking.operatorProfileId, booking.listingId, booking.departsAt);
  return { ok: true as const };
}

export async function resendConfirmation(input: { bookingId: string; operatorProfileId: string; actor: string }) {
  const booking = await ownedBooking(input.bookingId, input.operatorProfileId);
  if (!booking || booking.status !== "CONFIRMED") return fail("INVALID", "Only a confirmed booking has a confirmation to send.");
  if (!booking.leadEmail && !booking.whatsappOptIn) return fail("INVALID", "This booking has no email address or WhatsApp to send to.");
  await resendTravellerConfirmation(booking.id);
  await event(prisma, booking.id, "confirmation_sent", input.actor);
  return { ok: true as const };
}
