import { prisma } from "@/lib/db/prisma";
import {
  addDays,
  listDepartures,
  localDateInZone,
  ratesForDate,
} from "@/lib/services/operators/listing-availability";
import { confirmPayment } from "@/lib/services/rails/bookings";
import type { RailsPayments } from "@/lib/services/rails/payments";
import { DEFAULT_ZONE } from "@/lib/services/rails/views";

/**
 * What a traveller, or an agent like Kai, can read about a bookable trip. Nothing
 * here needs a session: it is the public face of the operator's inventory.
 *
 * Only a LIVE listing with a schedule and a price is bookable. A listing missing
 * either is reported as not bookable rather than shown with a calendar that can
 * never be completed.
 */

export async function bookableListing(slug: string) {
  const listing = await prisma.operatorListing.findUnique({
    where: { slug },
    include: {
      schedules: { where: { active: true }, orderBy: { createdAt: "asc" } },
      rates: { where: { active: true } },
      operatorProfile: { select: { companyName: true, status: true, rezdySupplierId: true } },
    },
  });
  if (!listing || listing.status !== "LIVE") return null;
  if (listing.schedules.length === 0 || listing.rates.length === 0) return null;
  const timezone = listing.schedules[0].timezone ?? DEFAULT_ZONE;
  const cutoffHours = Math.min(...listing.schedules.map((s) => s.cutoffHours));
  const maxAdvanceDays = Math.max(...listing.schedules.map((s) => s.maxAdvanceDays));
  return { listing, timezone, cutoffHours, maxAdvanceDays, operatorName: listing.operatorProfile.companyName ?? listing.title };
}

export type BookableListing = NonNullable<Awaited<ReturnType<typeof bookableListing>>>;

/**
 * The "From A$189" figure: the default price when it is per guest, otherwise the
 * cheapest per-guest price. Never the child price on its own, which would advertise
 * a number almost nobody pays.
 */
export function headlinePrice(b: BookableListing, date: string): number | null {
  const perGuest = ratesForDate(b.listing.rates, date).filter((r) => r.perGuest);
  const def = perGuest.find((r) => r.isDefault);
  if (def) return def.amountCents;
  const adults = perGuest.filter((r) => r.minAge === null && r.maxAge === null);
  const pool = adults.length ? adults : perGuest;
  return pool.length ? Math.min(...pool.map((r) => r.amountCents)) : null;
}

export type DayStatus = "available" | "soldout" | "closed" | "none";

/**
 * One month of days for the booking page's calendar. A day is "available" when at
 * least one departure can take one guest; the page re-asks for the real party size
 * once a day is picked.
 */
export async function monthAvailability(b: BookableListing, month: string, now = new Date()) {
  const [y, m] = month.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  const today = localDateInZone(now, b.timezone);
  const horizon = addDays(today, b.maxAdvanceDays);
  const from = first < today ? today : first;
  const to = last > horizon ? horizon : last;

  const days: { date: string; status: DayStatus; fromCents: number | null; seatsLeft: number }[] = [];
  const listed = from <= to ? await listDepartures({ listingId: b.listing.id, from, to, now }) : [];
  const byDate = new Map(listed.map((d) => [d.date, d]));

  for (let date = first; date <= last; date = addDays(date, 1)) {
    const day = byDate.get(date);
    if (!day || date < today) { days.push({ date, status: "none", fromCents: null, seatsLeft: 0 }); continue; }
    if (day.blackout) { days.push({ date, status: "closed", fromCents: null, seatsLeft: 0 }); continue; }
    const open = day.departures.filter((d) => d.block === null);
    const perGuest = ratesForDate(b.listing.rates, date).filter((r) => r.perGuest);
    const fromCents = perGuest.length ? Math.min(...perGuest.map((r) => r.amountCents)) : null;
    if (open.length > 0) {
      days.push({ date, status: "available", fromCents, seatsLeft: Math.max(...open.map((d) => d.seatsLeft)) });
    } else if (day.departures.some((d) => d.block === "full")) {
      days.push({ date, status: "soldout", fromCents, seatsLeft: 0 });
    } else {
      days.push({ date, status: day.departures.length ? "closed" : "none", fromCents: null, seatsLeft: 0 });
    }
  }
  return { month, today, timezone: b.timezone, currency: b.listing.currency, days };
}

/** The departures and prices for one date, for a party of a given size. */
export async function dayOptions(b: BookableListing, date: string, guests?: number, now = new Date()) {
  const [day] = await listDepartures({ listingId: b.listing.id, from: date, to: date, guests, now });
  const rates = ratesForDate(b.listing.rates, date).map((r) => ({
    id: r.id,
    label: r.label,
    amountCents: r.amountCents,
    currency: r.currency,
    perGuest: r.perGuest,
    minAge: r.minAge,
    maxAge: r.maxAge,
    isDefault: r.isDefault,
  }));
  return {
    date,
    timezone: b.timezone,
    blackout: day?.blackout ?? null,
    departures: (day?.departures ?? []).map((d) => ({
      departsAt: d.departsAt.toISOString(),
      localTime: d.localTime,
      seatsLeft: d.seatsLeft,
      minGuests: d.minGuests,
      available: d.block === null,
      block: d.block,
      note: d.closed ? d.note : null,
    })),
    rates,
  };
}

/**
 * The confirmation page's booking, found by the Stripe checkout id that only the
 * paying traveller's browser was sent back with. Asks Stripe directly when the
 * webhook has not landed yet, so "you're booked" never depends on its timing.
 */
export async function confirmationForSession(sessionId: string, payments: RailsPayments | null) {
  let booking = await prisma.listingBooking.findUnique({ where: { stripeCheckoutSessionId: sessionId } });
  if (!booking) return null;

  if (booking.status === "PENDING_PAYMENT" || booking.status === "EXPIRED") {
    if (payments) {
      try {
        const state = await payments.retrieveCheckout(sessionId);
        if (state.paid && state.bookingId === booking.id) {
          await confirmPayment({
            bookingId: booking.id,
            sessionId,
            paymentIntentId: state.paymentIntentId,
            amountTotal: state.amountTotal,
            currency: state.currency,
          }, payments);
          booking = await prisma.listingBooking.findUniqueOrThrow({ where: { id: booking.id } });
        }
      } catch (error) {
        console.warn("rails.confirmation_lookup_failed", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { booking, listing: await confirmationListing(booking.listingId) };
}

function confirmationListing(listingId: string) {
  return prisma.operatorListing.findUniqueOrThrow({
    where: { id: listingId },
    select: {
      title: true, slug: true, meetingPoint: true, confirmationNote: true, durationMinutes: true, heroImageUrl: true,
      operatorProfile: { select: { companyName: true, whatsappE164: true } },
    },
  });
}

/**
 * The confirmation page for a booking the operator's own system charged (Rezdy
 * automated payments), found by the guest's own key: there was no Bluepass checkout
 * to come back from.
 */
export async function confirmationForGuest(guestToken: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(guestToken)) return null;
  const booking = await prisma.listingBooking.findUnique({ where: { guestToken } });
  if (!booking) return null;
  return { booking, listing: await confirmationListing(booking.listingId) };
}
