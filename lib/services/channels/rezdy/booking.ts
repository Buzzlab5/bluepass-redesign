import type { ListingBooking, Prisma } from "@prisma/client";
import { CONSERVATION_PCT } from "@/lib/constants/economics";
import { prisma } from "@/lib/db/prisma";
import { addDays, localDateInZone } from "@/lib/services/operators/listing-availability";
import { RezdyError, rezdyApi, type RezdyApi, type RezdyBooking, type RezdyProduct, type RezdySession } from "@/lib/services/channels/rezdy/api";
import {
  buildBookingRequest,
  checkAnswers,
  chosenExtras,
  dayFromSessions,
  extrasFor,
  feesFor,
  findSession,
  monthFromSessions,
  paymentMode,
  priceRezdyParty,
  questionsFor,
  statusOfOrder,
  toCents,
  type RezdyPaymentMode,
} from "@/lib/services/channels/rezdy/map";
import type { RezdyListingData } from "@/lib/services/channels/rezdy/sync";
import type { ChannelAnswers, ChannelDeparture } from "@/lib/services/channels/types";
import { markDepartureChanged } from "@/lib/services/rails/calendar-events";
import {
  CHECKOUT_MINUTES,
  HOLD_MINUTES,
  cleanLead,
  cleanNotes,
  event,
  fail,
  newGuestToken,
  normalisePhone,
  refundWholePayment,
  type BookingFailure,
  type ConfirmOutcome,
  type LeadGuest,
  type PaymentConfirmation,
} from "@/lib/services/rails/bookings";
import { whatsappDigits } from "@/lib/services/rails/links";
import { splitOnlineBooking } from "@/lib/services/rails/money";
import {
  notifyBookingCancelled,
  notifyBookingConfirmed,
  notifyBookingMoved,
  notifyBookingRequested,
} from "@/lib/services/rails/notify";
import type { RailsPayments } from "@/lib/services/rails/payments";
import { newBookingReference } from "@/lib/services/rails/reference";

/**
 * Booking a Rezdy trip. Rezdy is the only inventory: seats and prices are read from it
 * live, and a booking exists in Bluepass only once Rezdy has one too.
 *
 * Two ways to be paid, set by the operator in Rezdy for Bluepass's rate:
 *
 * - Automated payments. The traveller's card is tokenised in the browser on Rezdy's
 *   own Stripe account and Rezdy charges it as it makes the booking, then pays the
 *   operator and Bluepass's commission itself. One step: the booking and the charge
 *   succeed or fail together, so nothing is held and nothing needs releasing.
 * - Full payment to agent. Bluepass takes the money through its own checkout and pays
 *   the operator after the trip, as it does for its own rails. The seats are held in
 *   Rezdy as a processing order while the traveller pays, then confirmed with the
 *   payment recorded; an abandoned checkout cancels the hold.
 *
 * Either way the price charged is Rezdy's own quote, checked against what the page
 * showed before any card is touched.
 */

export type RezdyTrip = {
  listing: { id: string; slug: string; title: string; operatorProfileId: string; currency: string };
  data: RezdyListingData;
  timezone: string;
  operatorName: string;
};

// ---------------------------------------------------------------------------
// Reading seats
// ---------------------------------------------------------------------------

/**
 * Rezdy asks agents to cache rather than call it for every page view, and limits each
 * key to 100 calls a minute. A minute is short enough that a traveller never sees a
 * stale "available", and the booking itself always reads fresh.
 */
const SESSION_TTL_MS = 60_000;
const sessionCache = new Map<string, { at: number; sessions: RezdySession[] }>();

export async function sessionsBetween(api: RezdyApi, productCode: string, from: string, to: string, fresh = false) {
  const key = `${productCode}|${from}|${to}`;
  const hit = sessionCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.sessions;
  const sessions = await api.availability({ productCode, startTimeLocal: `${from} 00:00:00`, endTimeLocal: `${to} 23:59:59` });
  sessionCache.set(key, { at: Date.now(), sessions });
  if (sessionCache.size > 400) sessionCache.delete(sessionCache.keys().next().value as string);
  return sessions;
}

export function clearSessionCache() {
  sessionCache.clear();
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  return { first, last };
}

/** Departures the operator closed on Bluepass (a weather call), which stop selling here at once. */
async function closedDepartures(listingId: string, from: Date, to: Date) {
  const rows = await prisma.listingDepartureOverride.findMany({
    where: { listingId, closed: true, departsAt: { gte: from, lte: to } },
    select: { departsAt: true },
  });
  return new Set(rows.map((r) => r.departsAt.getTime()));
}

function spanOf(sessions: RezdySession[]) {
  const times = sessions.map((s) => new Date(s.startTime.replace(" ", "T")).getTime()).filter((t) => !Number.isNaN(t));
  return times.length ? { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) } : null;
}

export async function rezdyMonth(trip: RezdyTrip, month: string, now = new Date(), api: RezdyApi | null = rezdyApi()) {
  const today = localDateInZone(now, trip.timezone);
  const { first, last } = monthBounds(month);
  const from = first < today ? today : first;
  const sessions = api && from <= last ? await sessionsBetween(api, trip.data.product.productCode, from, last) : [];
  const span = spanOf(sessions);
  const closed = span ? await closedDepartures(trip.listing.id, span.from, span.to) : new Set<number>();
  return {
    month,
    today,
    timezone: trip.timezone,
    currency: trip.data.product.currency || trip.listing.currency,
    days: monthFromSessions({ product: trip.data.product, sessions, month, today, now, closed }),
  };
}

export async function rezdyDay(trip: RezdyTrip, date: string, now = new Date(), api: RezdyApi | null = rezdyApi()) {
  const sessions = api ? await sessionsBetween(api, trip.data.product.productCode, date, date) : [];
  const span = spanOf(sessions);
  const closed = span ? await closedDepartures(trip.listing.id, span.from, span.to) : new Set<number>();
  const departures: ChannelDeparture[] = dayFromSessions(trip.data.product, sessions, date, now, closed);
  const first = departures.find((d) => d.available) ?? departures[0];
  return {
    date,
    timezone: trip.timezone,
    blackout: null,
    departures,
    rates: first?.rates ?? [],
    fees: feesFor(trip.data.product),
    extras: extrasFor(trip.data.product),
  };
}

/** The "From A$X" figure on a Rezdy trip. */
export function rezdyHeadline(product: RezdyProduct): number | null {
  const paid = (product.priceOptions ?? []).filter((o) => o.priceGroupType !== "TOTAL" && o.price > 0);
  return paid.length ? Math.round(Math.min(...paid.map((o) => o.price)) * 100) : null;
}

// ---------------------------------------------------------------------------
// Reserving
// ---------------------------------------------------------------------------

export type RezdyReserveInput = {
  listingId: string;
  departsAt: Date;
  quantities: Record<string, number>;
  /** Add-ons chosen, by name. Per-booking and per-guest ones are sized here, not by the request. */
  extras?: Record<string, number> | null;
  lead: LeadGuest;
  notes?: string | null;
  answers?: ChannelAnswers | null;
  whatsappOptIn?: boolean;
  referralCode?: string | null;
  source: "ONLINE" | "KAI";
  /** Automated payments: the card, tokenised on Rezdy's Stripe account in the traveller's browser. */
  cardToken?: string | null;
  /** The total the traveller was shown. A different quote is refused before any charge. */
  expectedTotalCents?: number | null;
  now?: Date;
};

export type RezdyReserveResult =
  | { ok: true; kind: "booked"; booking: ListingBooking }
  | { ok: true; kind: "checkout"; booking: ListingBooking; checkoutUrl: string }
  | (BookingFailure & { totalCents?: number });

type Deps = { api: RezdyApi | null; payments: RailsPayments | null };

function liveDeps(): Deps {
  return { api: rezdyApi(), payments: null };
}

/** Rezdy's refusals, in Bluepass's voice. */
function refusal(error: unknown, operatorName: string): BookingFailure {
  if (!(error instanceof RezdyError)) {
    console.error("rezdy.unexpected", { error: error instanceof Error ? error.message : String(error) });
    return fail("CHANNEL", `${operatorName}'s booking system did not answer. Nothing was charged; try again in a minute.`);
  }
  const code = error.code ?? "";
  if (/PAYMENT_REQUIRED_SCA/.test(code)) return fail("PAYMENT_FAILED", "Your bank wants to confirm this payment, which this booking system cannot do yet. Try another card.");
  if (/PAYMENT|CARD/.test(code)) return fail("PAYMENT_FAILED", "Your card was not accepted. Nothing was charged; try another card.");
  if (/MINIMUM_QUANTITY/.test(code)) return fail("INVALID", "This departure needs more guests than that.");
  if (/MAXIMUM_QUANTITY/.test(code)) return fail("INVALID", "This departure takes fewer guests than that.");
  if (error.detail?.seatsAvailable !== undefined || /availab|seat|sold/i.test(error.message)) {
    return fail("UNAVAILABLE", "Those seats have just gone. Pick another time.");
  }
  if (error.transient) return fail("CHANNEL", `${operatorName}'s booking system is busy. Nothing was charged; try again in a minute.`);
  return fail("INVALID", `${operatorName}'s booking system said: ${error.message}`);
}

async function uniqueReference() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const reference = newBookingReference();
    const taken = await prisma.listingBooking.findUnique({ where: { reference }, select: { id: true } });
    if (!taken) return reference;
  }
  throw new Error("Could not allocate a booking reference.");
}

/** Lines as sold, with anything Rezdy adds on top (taxes, fees) shown as its own line. */
function soldLines(lines: { rateId: string; label: string; amountCents: number; quantity: number; perGuest: boolean }[], totalCents: number) {
  const sum = lines.reduce((n, l) => n + l.amountCents * l.quantity, 0);
  return totalCents > sum
    ? [...lines, { rateId: "fees", label: "Taxes and fees", amountCents: totalCents - sum, quantity: 1, perGuest: false }]
    : lines;
}

function money(totalCents: number, commissionCents: number | null) {
  // The operator's share is what Rezdy says it is: the fare less the commission they set
  // for Bluepass. Without a figure from Rezdy it falls back to Bluepass's standard split.
  const conservationCents = Math.round(totalCents * CONSERVATION_PCT);
  const operatorNetCents = commissionCents !== null ? Math.max(0, totalCents - commissionCents) : splitOnlineBooking(totalCents).operatorNetCents;
  return { conservationCents, operatorNetCents };
}

export async function reserveRezdy(input: RezdyReserveInput, trip: RezdyTrip, deps: Deps = liveDeps(), urls?: {
  success: (booking: ListingBooking) => string;
  cancel: (booking: ListingBooking) => string;
}): Promise<RezdyReserveResult> {
  const now = input.now ?? new Date();
  const api = deps.api;
  if (!api) return fail("CHANNEL", "Rezdy bookings are not switched on yet.");
  const { product, pickups } = trip.data;
  const mode: RezdyPaymentMode | null = paymentMode(product);
  if (!mode) return fail("NOT_BOOKABLE", "This trip is not taking bookings on Bluepass right now.");

  const questions = questionsFor(product, pickups);
  const lead = cleanLead(input.lead, true);
  if (!lead.ok) return lead;
  const phone = normalisePhone(lead.lead.phone);
  if (questions.phoneRequired && !phone) return fail("INVALID", `Add a mobile number. ${trip.operatorName} needs one for this trip.`);
  const notes = cleanNotes(input.notes);
  if (questions.notesRequired && !notes) return fail("INVALID", "Tell the crew anything they should know, even if it is \"nothing\".");
  if (mode === "automated" && !input.cardToken) {
    return fail("INVALID", "Card details are needed to book this trip.");
  }
  if (mode === "agent" && !deps.payments) return fail("PAYMENTS_OFF", "Online payment is not switched on for this trip yet.");

  // Live seats, never the cached minute: this is the read the money depends on.
  const date = localDateInZone(input.departsAt, product.timezone || trip.timezone);
  let sessions: RezdySession[];
  try {
    sessions = await sessionsBetween(api, product.productCode, date, date, true);
  } catch (error) {
    return refusal(error, trip.operatorName);
  }
  const session = findSession(sessions, input.departsAt);
  if (!session) return fail("UNAVAILABLE", "That departure is no longer on sale. Pick another time.");
  const closedHere = await prisma.listingDepartureOverride.findUnique({
    where: { listingId_departsAt: { listingId: trip.listing.id, departsAt: input.departsAt } },
    select: { closed: true, note: true },
  });
  if (closedHere?.closed) return fail("UNAVAILABLE", closedHere.note ? `That departure is not running: ${closedHere.note}.` : "That departure is not running. Pick another time.");
  const notice = Math.max(0, product.minimumNoticeMinutes ?? 0) * 60_000;
  if (input.departsAt.getTime() - notice <= now.getTime()) return fail("UNAVAILABLE", "Online booking has closed for that departure.");

  const priced = priceRezdyParty(product, session, input.quantities);
  if (!priced.ok) return fail("INVALID", priced.reason);
  if (priced.seats > session.seatsAvailable) {
    return fail("UNAVAILABLE", session.seatsAvailable > 0 ? `Only ${session.seatsAvailable} ${session.seatsAvailable === 1 ? "seat" : "seats"} left at that time.` : "That departure is full. Pick another time.");
  }
  const answers: ChannelAnswers = input.answers ?? { fields: {}, participants: [], pickup: null };
  const problem = checkAnswers(questions, answers, priced.seats);
  if (problem) return fail("INVALID", problem);

  const units = priced.lines.reduce((n, l) => n + l.quantity, 0);
  const extras = chosenExtras(product, input.extras ?? undefined, units);
  if (!extras.ok) return fail("INVALID", extras.reason);

  const reference = await uniqueReference();
  const quantities = priced.lines.map((l) => ({ label: l.rateId, quantity: l.quantity }));
  const base = {
    product, session, quantities,
    extras: extras.extras.map((e) => ({ name: e.name, quantity: e.quantity })),
    lead: { name: lead.lead.name, email: lead.lead.email, phone }, notes, answers, reference,
  };
  const extraLines = extras.extras.map((e) => ({ rateId: `extra:${e.name}`, label: e.name, amountCents: e.amountCents, quantity: e.quantity, perGuest: false }));

  // Rezdy's quote is the price. It also runs Rezdy's own checks (booking questions,
  // quantities) before anything is held or charged.
  let quoteCents: number;
  let commissionCents: number | null;
  try {
    const quote = await api.quote(buildBookingRequest({ ...base, payment: { kind: "hold" } }));
    quoteCents = toCents(quote.totalAmount) ?? priced.totalCents;
    commissionCents = toCents(quote.commission);
  } catch (error) {
    return refusal(error, trip.operatorName);
  }
  if (quoteCents < 100) return fail("NOT_BOOKABLE", "This trip has no price for that departure.");
  if (input.expectedTotalCents != null && input.expectedTotalCents !== quoteCents) {
    return { ...fail("PRICE_CHANGED", "The total for this departure is different from what was shown. Check it and pay again."), totalCents: quoteCents };
  }

  const lines = soldLines([...priced.lines, ...extraLines], quoteCents);
  const booking = await prisma.listingBooking.create({
    data: {
      reference,
      listingId: trip.listing.id,
      operatorProfileId: trip.listing.operatorProfileId,
      departsAt: input.departsAt,
      timezone: product.timezone || trip.timezone,
      guests: priced.seats,
      lines: lines as unknown as Prisma.InputJsonValue,
      totalCents: quoteCents,
      currency: product.currency || trip.listing.currency,
      status: "PENDING_PAYMENT",
      source: input.source,
      paymentStatus: "UNPAID",
      leadName: lead.lead.name,
      leadEmail: lead.lead.email,
      leadPhone: phone,
      notes,
      referralCode: input.referralCode?.trim().slice(0, 64) || null,
      whatsappOptIn: Boolean(input.whatsappOptIn && whatsappDigits(phone)),
      guestToken: newGuestToken(),
      channel: "REZDY",
      commissionCents,
      answers: answers as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(now.getTime() + (mode === "automated" ? 15 : HOLD_MINUTES) * 60_000),
    },
  });
  await event(prisma, booking.id, "reserved", input.source === "KAI" ? "kai" : "traveller", `Rezdy ${session.startTimeLocal}, ${priced.seats} seats`);

  if (mode === "automated") return bookWithCard(booking, base, input.cardToken!, trip, api, now);
  return holdAndCheckout(booking, base, trip, api, deps.payments!, now, urls);
}

type BaseRequest = Omit<Parameters<typeof buildBookingRequest>[0], "payment">;

async function bookWithCard(booking: ListingBooking, base: BaseRequest, cardToken: string, trip: RezdyTrip, api: RezdyApi, now: Date): Promise<RezdyReserveResult> {
  let order: RezdyBooking;
  try {
    order = await api.createBooking(buildBookingRequest({ ...base, payment: { kind: "card", token: cardToken } }));
  } catch (error) {
    if (error instanceof RezdyError && error.transient) {
      // The charge may or may not have gone through. Leave the booking to the
      // reconciler, which finds the order by its reference if Rezdy made one.
      await event(prisma, booking.id, "rezdy_unconfirmed", "system", error.message);
      return fail("CHANNEL", `${trip.operatorName}'s booking system did not confirm in time. If your card was charged, your confirmation will arrive by email within 15 minutes; otherwise nothing was taken.`);
    }
    await prisma.listingBooking.update({
      where: { id: booking.id },
      data: { status: "EXPIRED", expiresAt: null, cancelReason: error instanceof Error ? error.message.slice(0, 300) : "Refused by Rezdy" },
    });
    await event(prisma, booking.id, "rezdy_refused", "rezdy", error instanceof Error ? error.message : undefined);
    return refusal(error, trip.operatorName);
  }
  try {
    const updated = await recordOrder(booking, order, { paidVia: "channel", now });
    return { ok: true, kind: "booked", booking: updated };
  } catch (error) {
    // Rezdy has the booking and has charged the card; only Bluepass's record failed. Say
    // so plainly, keep the order number where the reconciler and a person can find it,
    // and never tell the traveller nothing happened.
    console.error("rezdy.record_failed", { reference: booking.reference, orderNumber: order.orderNumber, error: error instanceof Error ? error.message : String(error) });
    await event(prisma, booking.id, "rezdy_record_failed", "system", `Rezdy order ${order.orderNumber ?? "unknown"} (${order.status ?? "unknown"}) was made but not recorded.`,
      { orderNumber: order.orderNumber ?? null, status: order.status ?? null }).catch(() => {});
    return fail("CHANNEL", `You are booked with ${trip.operatorName}${order.orderNumber ? ` (their reference ${order.orderNumber})` : ""}, but Bluepass could not file it just now. Your confirmation will follow by email; please do not book again.`);
  }
}

async function holdAndCheckout(
  booking: ListingBooking,
  base: BaseRequest,
  trip: RezdyTrip,
  api: RezdyApi,
  payments: RailsPayments,
  now: Date,
  urls?: { success: (booking: ListingBooking) => string; cancel: (booking: ListingBooking) => string },
): Promise<RezdyReserveResult> {
  // Hold the seats in Rezdy while the traveller pays. If Rezdy will not hold them, the
  // booking is made after payment instead, and refunded in full if the seats went.
  try {
    const hold = await api.createBooking(buildBookingRequest({ ...base, payment: { kind: "hold" } }));
    if (hold.orderNumber) {
      booking = await prisma.listingBooking.update({
        where: { id: booking.id },
        data: { externalReference: hold.orderNumber, externalStatus: hold.status ?? "PROCESSING", externalSyncedAt: now },
      });
    }
  } catch (error) {
    if (error instanceof RezdyError && !error.transient && error.detail?.seatsAvailable !== undefined) {
      await prisma.listingBooking.update({ where: { id: booking.id }, data: { status: "EXPIRED", expiresAt: null } });
      return refusal(error, trip.operatorName);
    }
    await event(prisma, booking.id, "rezdy_hold_skipped", "system", error instanceof Error ? error.message : undefined);
  }

  try {
    const session = await payments.createCheckout({
      bookingId: booking.id,
      reference: booking.reference,
      currency: booking.currency,
      lines: booking.lines as unknown as { label: string; amountCents: number; quantity: number }[],
      productName: trip.listing.title,
      description: `${booking.reference} · ${trip.operatorName}`,
      customerEmail: booking.leadEmail ?? undefined,
      successUrl: urls?.success(booking) ?? "",
      cancelUrl: urls?.cancel(booking) ?? "",
      expiresAt: new Date(now.getTime() + CHECKOUT_MINUTES * 60_000),
    });
    const updated = await prisma.listingBooking.update({ where: { id: booking.id }, data: { stripeCheckoutSessionId: session.id } });
    return { ok: true, kind: "checkout", booking: updated, checkoutUrl: session.url };
  } catch (error) {
    await releaseRezdyHold(booking.id, "The payment page could not be opened.", api);
    console.error("rezdy.checkout_failed", { reference: booking.reference, error: error instanceof Error ? error.message : String(error) });
    return fail("PAYMENT_FAILED", "We could not open the payment page. Nothing was charged; please try again.");
  }
}

/**
 * Writes what Rezdy says about an order onto the booking: its number, status and
 * commission, and the money as it now stands. Sends the traveller's confirmation (or,
 * for a trip the operator accepts by hand, the note that their request is in).
 */
type StripeIds = { stripeCheckoutSessionId?: string | null; stripePaymentIntentId?: string | null; stripeChargeId?: string | null };

async function recordOrder(booking: ListingBooking, order: RezdyBooking, opts: { paidVia: "channel" | "bluepass"; now: Date; payment?: StripeIds }) {
  const status = statusOfOrder(order.status) ?? "CONFIRMED";
  const settled = status === "CONFIRMED" || status === "REQUESTED" ? status : "CONFIRMED";
  const totalCents = toCents(order.totalAmount) ?? booking.totalCents;
  const commissionCents = toCents(order.commission) ?? booking.commissionCents;
  const split = money(totalCents, commissionCents);
  const updated = await prisma.listingBooking.update({
    where: { id: booking.id },
    data: {
      status: settled,
      paymentStatus: opts.paidVia === "channel" ? "PAID_VIA_CHANNEL" : "PAID",
      paidAt: opts.now,
      expiresAt: null,
      totalCents,
      commissionCents,
      conservationCents: split.conservationCents,
      operatorNetCents: split.operatorNetCents,
      externalReference: order.orderNumber ?? booking.externalReference,
      externalStatus: order.status ?? null,
      externalSyncedAt: opts.now,
      ...opts.payment,
    },
  });
  await event(prisma, booking.id, opts.paidVia === "channel" ? "paid_via_rezdy" : "paid", opts.paidVia === "channel" ? "rezdy" : "stripe",
    `Rezdy order ${order.orderNumber ?? "pending"} (${order.status ?? "unknown"})`);
  await markDepartureChanged(updated.operatorProfileId, updated.listingId, updated.departsAt);
  if (updated.status === "CONFIRMED") await notifyBookingConfirmed(updated.id);
  else await notifyBookingRequested(updated.id);
  return updated;
}

// ---------------------------------------------------------------------------
// Full payment to agent: after Stripe says paid
// ---------------------------------------------------------------------------

function paymentRecord(booking: ListingBooking, input: PaymentConfirmation, now: Date) {
  return {
    kind: "paid" as const,
    amountCents: input.amountTotal ?? booking.totalCents,
    currency: (input.currency ?? booking.currency).toUpperCase(),
    label: `Paid to Bluepass by card, ${booking.reference}${input.paymentIntentId ? ` (${input.paymentIntentId})` : ""}`,
    at: now,
  };
}

/** Rebuilds the order a hold was made from, for confirming it or booking it afresh. */
async function requestFor(booking: ListingBooking, api: RezdyApi) {
  const listing = await prisma.operatorListing.findUniqueOrThrow({ where: { id: booking.listingId }, select: { channelData: true } });
  const data = listing.channelData as unknown as RezdyListingData | null;
  if (!data?.product) return null;
  const date = localDateInZone(booking.departsAt, booking.timezone);
  const sessions = await sessionsBetween(api, data.product.productCode, date, date, true);
  const session = findSession(sessions, booking.departsAt);
  if (!session) return null;
  const sold = booking.lines as unknown as { rateId: string; label: string; quantity: number }[];
  const tickets = sold.filter((l) => l.rateId !== "fees" && !l.rateId.startsWith("extra:"));
  const extras = sold.filter((l) => l.rateId.startsWith("extra:"));
  return {
    product: data.product,
    session,
    quantities: tickets.map((l) => ({ label: l.rateId, quantity: l.quantity })),
    extras: extras.map((l) => ({ name: l.label, quantity: l.quantity })),
    lead: { name: booking.leadName, email: booking.leadEmail, phone: booking.leadPhone },
    notes: booking.notes,
    answers: (booking.answers as unknown as ChannelAnswers | null) ?? { fields: {}, participants: [], pickup: null },
    reference: booking.reference,
  } satisfies BaseRequest;
}

/**
 * Stripe says a Rezdy trip was paid for. Confirms the held order in Rezdy with the
 * payment recorded; if the hold is gone, books afresh; if the seats are gone too, the
 * traveller gets every cent back. Idempotent, like the native confirmPayment.
 */
export async function confirmRezdyPayment(
  input: PaymentConfirmation,
  payments: RailsPayments | null,
  api: RezdyApi | null = rezdyApi(),
): Promise<ConfirmOutcome> {
  const now = input.now ?? new Date();
  const booking = await prisma.listingBooking.findUnique({ where: { id: input.bookingId } });
  if (!booking) return "unknown";
  if ((booking.status === "CONFIRMED" || booking.status === "REQUESTED") && booking.paymentStatus === "PAID") return "already_confirmed";
  if (booking.paymentStatus === "REFUNDED") return "already_confirmed";
  const paidCents = input.amountTotal ?? booking.totalCents;
  const stripe = { stripeCheckoutSessionId: input.sessionId, stripePaymentIntentId: input.paymentIntentId };

  if (booking.status === "CANCELLED") {
    await refundWholePayment(booking, input, paidCents, payments, "The booking was cancelled before the payment completed.");
    return "refunded_cancelled";
  }
  if (!api) {
    await event(prisma, booking.id, "rezdy_confirm_pending", "system", "Paid, but Rezdy is not configured to confirm it.");
    await prisma.listingBooking.update({ where: { id: booking.id }, data: { paymentStatus: "PAID", paidAt: now, ...stripe } });
    return "unknown";
  }

  const payment = paymentRecord(booking, input, now);
  let order: RezdyBooking | null = null;

  if (booking.externalReference) {
    try {
      const held = await api.getBooking(booking.externalReference);
      if (held && statusOfOrder(held.status) !== "CANCELLED") {
        const paid = { type: "CREDITCARD", amount: payment.amountCents / 100, currency: payment.currency, date: now.toISOString(), label: payment.label, recipient: "RESELLER" as const };
        try {
          order = await api.updateBooking(booking.externalReference, { ...held, status: "CONFIRMED", payments: [...(held.payments ?? []), paid] });
        } catch {
          // Some accounts only accept a status change on update. The payment then stands
          // in Bluepass's records and the operator's agent statement, not on the order.
          order = await api.updateBooking(booking.externalReference, { ...held, status: "CONFIRMED" });
        }
      }
    } catch (error) {
      await event(prisma, booking.id, "rezdy_confirm_failed", "system", error instanceof Error ? error.message : undefined);
    }
  }

  if (!order) {
    try {
      const request = await requestFor(booking, api);
      if (request) order = await api.createBooking(buildBookingRequest({ ...request, payment }));
    } catch (error) {
      await event(prisma, booking.id, "rezdy_rebook_failed", "system", error instanceof Error ? error.message : undefined);
    }
  }

  if (!order?.orderNumber) {
    await prisma.listingBooking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "system", cancelReason: "The operator's booking system could not take the booking after payment." },
    });
    const fresh = await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } });
    await refundWholePayment(fresh, input, paidCents, payments, "The departure filled before your payment arrived.");
    return "refunded_full";
  }

  let chargeId: string | null = null;
  if (payments && input.paymentIntentId) chargeId = await payments.chargeIdFor(input.paymentIntentId).catch(() => null);
  await recordOrder(booking, order, { paidVia: "bluepass", now, payment: { ...stripe, ...(chargeId ? { stripeChargeId: chargeId } : {}) } });
  return "confirmed";
}

/** Lets go of seats held in Rezdy for a checkout that was abandoned. */
export async function releaseRezdyHold(bookingId: string, reason: string, api: RezdyApi | null = rezdyApi()) {
  const booking = await prisma.listingBooking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== "PENDING_PAYMENT") return;
  if (booking.externalReference && api) {
    await api.cancelBooking(booking.externalReference, { sendNotifications: false }).catch(async (error) => {
      await event(prisma, booking.id, "rezdy_release_failed", "system", error instanceof Error ? error.message : undefined);
    });
  }
  await prisma.listingBooking.update({ where: { id: bookingId }, data: { status: "EXPIRED", expiresAt: null, cancelReason: reason } });
  await event(prisma, booking.id, "expired", "system", reason);
}

/** Holds in Rezdy whose checkout ran out, let go so the operator's other channels can sell them. */
export async function releaseLapsedRezdyHolds(now = new Date(), api: RezdyApi | null = rezdyApi()) {
  const lapsed = await prisma.listingBooking.findMany({
    where: { channel: "REZDY", status: "PENDING_PAYMENT", paymentStatus: "UNPAID", expiresAt: { lt: now }, stripeCheckoutSessionId: { not: null } },
    select: { id: true },
    take: 50,
  });
  for (const { id } of lapsed) await releaseRezdyHold(id, "The payment page expired before it was used.", api);
  return lapsed.length;
}

// ---------------------------------------------------------------------------
// Cancelling, from either side
// ---------------------------------------------------------------------------

/**
 * Cancels the order in Rezdy before Bluepass records anything, so a cancellation that
 * Rezdy refuses changes nothing. For automated payments Rezdy refunds the card itself.
 */
export async function cancelRezdyOrder(booking: ListingBooking, api: RezdyApi | null = rezdyApi()): Promise<{ ok: true; refundedByRezdy: boolean } | BookingFailure> {
  if (!booking.externalReference) return { ok: true, refundedByRezdy: false };
  if (!api) return fail("CHANNEL", "Rezdy is not connected right now, so this booking cannot be cancelled here. Cancel it in Rezdy and it will update here.");
  try {
    await api.cancelBooking(booking.externalReference, { sendNotifications: false });
  } catch (error) {
    return fail("CHANNEL", `Rezdy did not cancel it: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`);
  }
  return { ok: true, refundedByRezdy: booking.paymentStatus === "PAID_VIA_CHANNEL" };
}

/**
 * Brings one booking in line with its Rezdy order. This is how an operator who
 * cancels or moves a booking in Rezdy, which they will, because it is the system they
 * use every day, has Bluepass follow: the traveller is refunded and told, or told the
 * new time, without the operator touching Bluepass at all.
 */
export async function reconcileRezdyOrder(
  order: RezdyBooking,
  deps: { api?: RezdyApi | null; payments?: RailsPayments | null; now?: Date } = {},
): Promise<"updated" | "unchanged" | "unknown"> {
  const now = deps.now ?? new Date();
  const booking = await prisma.listingBooking.findFirst({
    where: {
      channel: "REZDY",
      OR: [
        ...(order.orderNumber ? [{ externalReference: order.orderNumber }] : []),
        ...(order.resellerReference ? [{ reference: order.resellerReference }] : []),
      ],
    },
  });
  if (!booking) return "unknown";
  const next = statusOfOrder(order.status);
  const stamp = { externalStatus: order.status ?? booking.externalStatus, externalSyncedAt: now, externalReference: order.orderNumber ?? booking.externalReference };

  // Cancelled in Rezdy.
  if (next === "CANCELLED") {
    if (booking.status === "CONFIRMED" || booking.status === "REQUESTED") {
      const reason = "Cancelled by the operator";
      let refundedCents = 0;
      if (booking.paymentStatus === "PAID" && booking.stripePaymentIntentId && deps.payments !== null) {
        const payments = deps.payments;
        const remaining = booking.totalCents - booking.refundedCents;
        if (payments && remaining > 0) {
          const refund = await payments.refund({
            paymentIntentId: booking.stripePaymentIntentId,
            amountCents: remaining,
            idempotencyKey: `rails-refund-rezdy-${booking.id}`,
            bookingReference: booking.reference,
          });
          refundedCents = remaining;
          await event(prisma, booking.id, "refunded", "rezdy", undefined, { refundId: refund.id, amountCents: remaining });
        } else if (remaining > 0) {
          await event(prisma, booking.id, "refund_needed", "rezdy", "Cancelled in Rezdy and no payment provider to refund through.");
        }
      } else if (booking.paymentStatus === "PAID_VIA_CHANNEL") {
        refundedCents = booking.totalCents - booking.refundedCents;
      }
      await prisma.listingBooking.update({
        where: { id: booking.id },
        data: {
          ...stamp,
          status: "CANCELLED",
          cancelledAt: now,
          cancelledBy: "rezdy",
          cancelReason: reason,
          ...(refundedCents > 0 ? { paymentStatus: "REFUNDED", refundedCents: booking.refundedCents + refundedCents, conservationCents: 0, operatorNetCents: 0 } : {}),
        },
      });
      await event(prisma, booking.id, "cancelled", "rezdy", "Cancelled in Rezdy");
      await markDepartureChanged(booking.operatorProfileId, booking.listingId, booking.departsAt);
      await notifyBookingCancelled(booking.id, { reason: "The operator cancelled the booking", refundedCents });
      return "updated";
    }
    if (booking.status === "PENDING_PAYMENT") {
      await prisma.listingBooking.update({ where: { id: booking.id }, data: { ...stamp, status: "EXPIRED", expiresAt: null } });
      return "updated";
    }
    return "unchanged";
  }

  // Confirmed in Rezdy after waiting for the operator, or an automated booking whose
  // answer was lost on the way back.
  if ((next === "CONFIRMED" || next === "REQUESTED") && booking.status === "PENDING_PAYMENT" && !booking.stripeCheckoutSessionId) {
    await recordOrder(booking, order, { paidVia: "channel", now });
    return "updated";
  }
  if (next === "CONFIRMED" && booking.status === "REQUESTED") {
    await prisma.listingBooking.update({ where: { id: booking.id }, data: { ...stamp, status: "CONFIRMED" } });
    await event(prisma, booking.id, "accepted", "rezdy", "Accepted by the operator in Rezdy");
    await notifyBookingConfirmed(booking.id);
    return "updated";
  }

  // Moved in Rezdy to another time.
  const startTime = order.items?.[0]?.startTime;
  if ((booking.status === "CONFIRMED" || booking.status === "REQUESTED") && startTime) {
    const departsAt = new Date(startTime.replace(" ", "T"));
    if (!Number.isNaN(departsAt.getTime()) && departsAt.getTime() !== booking.departsAt.getTime()) {
      await prisma.listingBooking.update({ where: { id: booking.id }, data: { ...stamp, departsAt } });
      await event(prisma, booking.id, "moved", "rezdy", `Moved from ${booking.departsAt.toISOString()} to ${departsAt.toISOString()}`);
      await markDepartureChanged(booking.operatorProfileId, booking.listingId, booking.departsAt);
      await markDepartureChanged(booking.operatorProfileId, booking.listingId, departsAt);
      await notifyBookingMoved(booking.id, booking.departsAt);
      return "updated";
    }
  }

  if (order.status && order.status !== booking.externalStatus) {
    await prisma.listingBooking.update({ where: { id: booking.id }, data: stamp });
    return "updated";
  }
  return "unchanged";
}

const CURSOR = "rezdy:bookings";

/**
 * Every Rezdy order Bluepass made that has changed since the last run, reconciled.
 * Webhooks make this fast; this makes it certain, because Rezdy does not retry a
 * webhook that fails.
 */
export async function reconcileRezdyBookings(now = new Date(), api: RezdyApi | null = rezdyApi(), payments: RailsPayments | null = null) {
  if (!api) return { skipped: "REZDY_API_KEY is not set." };
  const cursor = await prisma.channelCursor.findUnique({ where: { key: CURSOR } });
  const since = cursor?.value ?? new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const counts = { seen: 0, updated: 0, recovered: 0 };

  const orders = await api.searchBookings({ updatedSince: since, limit: 500 });
  for (const order of orders) {
    counts.seen += 1;
    if ((await reconcileRezdyOrder(order, { api, payments, now })) === "updated") counts.updated += 1;
  }

  // Automated bookings whose answer never came back: ask Rezdy by reference.
  const unanswered = await prisma.listingBooking.findMany({
    where: { channel: "REZDY", status: "PENDING_PAYMENT", stripeCheckoutSessionId: null, createdAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
    select: { id: true, reference: true, expiresAt: true },
    take: 20,
  });
  for (const b of unanswered) {
    const [order] = await api.searchBookings({ resellerReference: b.reference, limit: 1 }).catch(() => []);
    if (order && (await reconcileRezdyOrder(order, { api, payments, now })) === "updated") { counts.recovered += 1; continue; }
    if (b.expiresAt && b.expiresAt < now) {
      await prisma.listingBooking.update({ where: { id: b.id }, data: { status: "EXPIRED", expiresAt: null, cancelReason: "Rezdy never confirmed the booking." } });
    }
  }

  // Overlap the next window by two minutes: a little re-reading is cheaper than a missed cancellation.
  await prisma.channelCursor.upsert({
    where: { key: CURSOR },
    create: { key: CURSOR, value: new Date(now.getTime() - 2 * 60_000).toISOString() },
    update: { value: new Date(now.getTime() - 2 * 60_000).toISOString() },
  });
  return counts;
}

/** A webhook from Rezdy names an order; the order itself is read fresh, never trusted from the payload. */
export async function reconcileRezdyOrderNumber(orderNumber: string, api: RezdyApi | null = rezdyApi(), payments: RailsPayments | null = null) {
  if (!api) return "unknown" as const;
  const order = await api.getBooking(orderNumber);
  return order ? reconcileRezdyOrder(order, { api, payments }) : ("unknown" as const);
}
