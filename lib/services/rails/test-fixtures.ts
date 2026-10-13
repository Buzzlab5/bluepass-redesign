import { prisma } from "@/lib/db/prisma";
import type { BusyInterval } from "@/lib/services/operators/listing-availability";
import { GoogleApiError, type GoogleCalendarApi, type GoogleEventBody } from "@/lib/services/rails/google/api";
import type { NotifyDeps } from "@/lib/services/rails/notify";
import type { CheckoutState, RailsPayments } from "@/lib/services/rails/payments";

/**
 * Shared set-up for the rails suite: one operator with one live reef trip that runs
 * Tue, Thu and Sat at 08:00 Brisbane time, and a payment fake that records every
 * call so a test can assert "refunded exactly once, for exactly this much".
 */

export async function resetRailsTables() {
  await prisma.$executeRawUnsafe(`TRUNCATE "ChannelCursor", "ChannelHandoff", "OperatorChannelConnection",
    "RailsNotification", "DepartureCalendarEvent", "OperatorBusyBlock",
    "OperatorGoogleConnection", "OperatorRailsSettings", "ListingBookingEvent", "ListingBooking", "ListingSeatHold",
    "ListingDepartureOverride", "ListingBlackout", "ListingRate", "ListingSchedule", "OperatorListing",
    "OperatorProfile", "BluePassAccount" CASCADE`);
}

export async function seedOperator(opts: { email?: string; capacity?: number; cutoffHours?: number } = {}) {
  const account = await prisma.bluePassAccount.create({
    data: { email: opts.email ?? `op-${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", roles: ["OPERATOR"] },
  });
  const profile = await prisma.operatorProfile.create({
    data: { accountId: account.id, status: "APPROVED", companyName: "Reef Runner Charters", whatsappE164: "+61400000000" },
  });
  const listing = await prisma.operatorListing.create({
    data: {
      operatorProfileId: profile.id,
      title: "Outer Reef Snorkel Day",
      slug: `outer-reef-${Math.random().toString(36).slice(2, 8)}`,
      category: "Dive",
      region: "Great Barrier Reef",
      description: "A full day on the outer reef with two snorkel sites.",
      status: "LIVE",
      publishedAt: new Date(),
      priceFrom: 189,
      meetingPoint: "Marina Pier B, Cairns",
    },
  });
  const schedule = await prisma.listingSchedule.create({
    data: {
      listingId: listing.id,
      weekdays: [2, 4, 6],
      departureTimes: ["08:00"],
      capacityPerDeparture: opts.capacity ?? 12,
      cutoffHours: opts.cutoffHours ?? 24,
      timezone: "Australia/Brisbane",
    },
  });
  const adult = await prisma.listingRate.create({
    data: { listingId: listing.id, label: "Adult", amountCents: 18900, isDefault: true },
  });
  const child = await prisma.listingRate.create({
    data: { listingId: listing.id, label: "Child 4 to 14", amountCents: 9900, minAge: 4, maxAge: 14 },
  });
  return { account, profile, listing, schedule, adult, child };
}

/** Thursday 2026-07-16, 08:00 in Brisbane. */
export const THURSDAY_8AM = new Date("2026-07-15T22:00:00Z");
/** Well before the cutoff for that departure. */
export const EARLY = new Date("2026-07-01T00:00:00Z");

export type PaymentCall = { kind: string; [key: string]: unknown };

export function fakePayments(opts: { failRefund?: boolean; failCheckout?: boolean; checkout?: CheckoutState } = {}) {
  const calls: PaymentCall[] = [];
  let n = 0;
  const payments: RailsPayments = {
    async createCheckout(input) {
      calls.push({ kind: "checkout", ...input });
      if (opts.failCheckout) throw new Error("stripe down");
      n += 1;
      return { id: `cs_test_${n}`, url: `https://checkout.stripe.test/${n}` };
    },
    async expireCheckout(sessionId) {
      calls.push({ kind: "expire", sessionId });
    },
    async retrieveCheckout(sessionId) {
      calls.push({ kind: "retrieve", sessionId });
      return opts.checkout ?? { bookingId: null, paid: false, paymentIntentId: null, amountTotal: null, currency: null };
    },
    async refund(input) {
      calls.push({ kind: "refund", ...input });
      if (opts.failRefund) throw new Error("card declined the refund");
      n += 1;
      return { id: `re_test_${n}` };
    },
    async chargeIdFor(paymentIntentId) {
      calls.push({ kind: "charge", paymentIntentId });
      return `ch_for_${paymentIntentId}`;
    },
    async transfer(input) {
      calls.push({ kind: "transfer", ...input });
      n += 1;
      return { id: `tr_test_${n}` };
    },
  };
  return { payments, calls };
}

// ---------------------------------------------------------------------------
// Google Calendar and messaging fakes
// ---------------------------------------------------------------------------


/**
 * A Google account in memory: calendars that hold events, and busy time per calendar.
 * `revoked` makes token refresh fail the way Google does when access is withdrawn.
 */
export function fakeGoogle(opts: { revoked?: boolean; offline?: boolean; busy?: Record<string, BusyInterval[]>; unreadable?: string[] } = {}) {
  const calls: PaymentCall[] = [];
  const calendars = new Map<string, Map<string, GoogleEventBody>>();
  let n = 0;
  const api: GoogleCalendarApi = {
    async accessToken(refreshToken) {
      calls.push({ kind: "token" });
      if (opts.revoked) throw new GoogleApiError("Token has been expired or revoked.", 400, "invalid_grant");
      if (opts.offline) throw new TypeError("fetch failed");
      return `at_${refreshToken}`;
    },
    async revoke() {
      calls.push({ kind: "revoke" });
    },
    async createCalendar(_token, input) {
      n += 1;
      const id = `bluepass_${n}@group.calendar.google.com`;
      calendars.set(id, new Map());
      calls.push({ kind: "createCalendar", id, ...input });
      return id;
    },
    async calendarExists(_token, calendarId) {
      return calendars.has(calendarId);
    },
    async deleteCalendar(_token, calendarId) {
      calendars.delete(calendarId);
      calls.push({ kind: "deleteCalendar", calendarId });
    },
    async listCalendars() {
      return [
        { id: "kate@example.test", summary: "Kate Moreno", primary: true, accessRole: "owner" },
        { id: "boat@group.calendar.google.com", summary: "Reef Runner (boat)", primary: false, accessRole: "owner" },
        ...[...calendars.keys()].map((id) => ({ id, summary: "Bluepass bookings", primary: false, accessRole: "owner" })),
      ];
    },
    async putEvent(_token, calendarId, eventId, body) {
      const events = calendars.get(calendarId);
      if (!events) throw new GoogleApiError("Not Found", 404, "notFound");
      events.set(eventId, body);
      calls.push({ kind: "put", calendarId, eventId, body });
    },
    async deleteEvent(_token, calendarId, eventId) {
      calendars.get(calendarId)?.delete(eventId);
      calls.push({ kind: "delete", calendarId, eventId });
    },
    async freeBusy(_token, calendarIds, timeMin, timeMax) {
      calls.push({ kind: "freeBusy", calendarIds, timeMin, timeMax });
      return Object.fromEntries(calendarIds.map((id) => [id, opts.unreadable?.includes(id)
        ? { busy: [], error: "notFound" }
        : { busy: (opts.busy?.[id] ?? []).filter((b) => b.startsAt < timeMax && b.endsAt > timeMin), error: null }]));
    },
  };
  return { api, calls, calendars, setBusy: (busy: Record<string, BusyInterval[]>) => { opts.busy = busy; } };
}

/** Records every message instead of sending it. `whatsapp: false` is WhatsApp not switched on. */
export function fakeNotify(opts: { whatsapp?: boolean; failWhatsApp?: boolean } = {}) {
  const sent: PaymentCall[] = [];
  const deps: NotifyDeps = {
    whatsapp: opts.whatsapp === false ? null : async ({ to, template, components }) => {
      sent.push({ kind: "whatsapp", to, template: template.name, components });
      if (opts.failWhatsApp) throw new Error("(#131026) Message undeliverable");
      return { providerMessageId: `wamid.${sent.length}` };
    },
    email: async ({ to, subject }) => {
      sent.push({ kind: "email", to, subject });
      return { delivered: true };
    },
  };
  return { deps, sent };
}
