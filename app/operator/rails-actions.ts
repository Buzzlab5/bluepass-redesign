"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import { railsAccess } from "@/lib/services/rails/access";
import {
  cancelBooking,
  cancelDeparture,
  createOperatorBooking,
  markCollected,
  resendConfirmation,
  setCheckedIn,
  setDepartureOverride,
} from "@/lib/services/rails/bookings";
import { syncCalendarSoon } from "@/lib/services/rails/background";
import { googleCalendarApi } from "@/lib/services/rails/google/api";
import { disconnectGoogle, operatorCalendars, refreshBusyBlocks, syncOperatorCalendar } from "@/lib/services/rails/google/sync";
import { notifyDepartureUpdate } from "@/lib/services/rails/notify";
import { railsPayments } from "@/lib/services/rails/payments";
import {
  addFareHarborTrip,
  connectFareHarbor,
  disconnectFareHarbor,
  linkFareHarborTrip,
  unlinkFareHarborTrip,
} from "@/lib/services/channels/fareharbor/connect";
import { connectRezdy, disconnectRezdy, setRezdyAutoPublish, syncOperatorRezdy, type ChannelResult } from "@/lib/services/channels/rezdy/sync";
import {
  addBlackout,
  addOneOffDeparture,
  removeBlackout,
  removeRate,
  removeSchedule,
  saveLogistics,
  saveRate,
  saveSchedule,
  type SetupResult,
} from "@/lib/services/rails/setup";

/**
 * Server actions for the booking CMS. Same rule as app/operator/actions.ts: the
 * operator is read from the session on every call, never from the form, and every
 * service below checks the row it touches belongs to that operator. A tampered form
 * can name any listing or booking id it likes and still only reach its own.
 */

export type RailsActionState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string; field?: string };

async function operator() {
  const access = await currentOperatorAccess();
  if (!access.ok) {
    return {
      failure: {
        status: "error" as const,
        message: access.reason === "SIGNED_OUT"
          ? "Your session has expired. Sign in again and retry; nothing was changed."
          : "This account can no longer manage these bookings. Nothing was changed.",
      },
    };
  }
  const rails = await railsAccess(access.profile);
  if (!rails.enabled) return { failure: { status: "error" as const, message: rails.reason } };
  return { access };
}

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Blank is null, not zero: an empty field is "not set", never a real 0. */
function int(form: FormData, name: string): number | null {
  const v = text(form, name);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : Number.NaN;
}

function money(form: FormData, name: string): number | null {
  const v = text(form, name).replace(/[,\s]/g, "").replace(/^[A-Z$]+/i, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toState(result: SetupResult): RailsActionState {
  return result.ok ? { status: "done", message: result.message } : { status: "error", message: result.message, field: result.field };
}

/**
 * Every console page reads live rows, so after any change the whole operator area is
 * re-rendered rather than a guessed list of paths: a manifest, a calendar and a
 * booking all show the same seats, and missing one leaves two screens disagreeing.
 */
function refreshConsole() {
  revalidatePath("/operator", "layout");
}


// ---------------------------------------------------------------------------
// Trip setup
// ---------------------------------------------------------------------------

export async function saveScheduleAction(listingId: string, scheduleId: string | null, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;

  const result = await saveSchedule({
    operatorProfileId: access.profile.id,
    listingId,
    scheduleId,
    values: {
      label: text(form, "label") || undefined,
      weekdays: form.getAll("weekday").map(Number),
      departureTimes: form.getAll("time").map((t) => String(t).trim()).filter(Boolean),
      capacityPerDeparture: int(form, "capacity") ?? Number.NaN,
      minGuests: int(form, "minGuests") ?? 1,
      cutoffHours: int(form, "cutoffHours") ?? 24,
      maxAdvanceDays: int(form, "maxAdvanceDays") ?? 365,
      timezone: text(form, "timezone"),
      seasonStart: text(form, "seasonStart") || null,
      seasonEnd: text(form, "seasonEnd") || null,
    },
  });
  if (result.ok) refreshConsole();
  return toState(result);
}

export async function removeScheduleAction(listingId: string, scheduleId: string, _prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await removeSchedule({ operatorProfileId: access.profile.id, listingId, scheduleId });
  if (result.ok) refreshConsole();
  return toState(result);
}

export async function addOneOffAction(listingId: string, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await addOneOffDeparture({
    operatorProfileId: access.profile.id,
    listingId,
    date: text(form, "date"),
    time: text(form, "time"),
    capacity: int(form, "capacity") ?? Number.NaN,
    timezone: text(form, "timezone"),
  });
  if (result.ok) refreshConsole();
  return toState(result);
}

export async function saveRateAction(listingId: string, rateId: string | null, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await saveRate({
    operatorProfileId: access.profile.id,
    listingId,
    rateId,
    values: {
      label: text(form, "label"),
      amount: money(form, "amount") ?? Number.NaN,
      perGuest: text(form, "per") !== "booking",
      minAge: int(form, "minAge"),
      maxAge: int(form, "maxAge"),
      seasonStart: text(form, "seasonStart") || null,
      seasonEnd: text(form, "seasonEnd") || null,
      isDefault: form.get("isDefault") === "on",
    },
  });
  if (result.ok) refreshConsole();
  return toState(result);
}

export async function removeRateAction(listingId: string, rateId: string, _prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await removeRate({ operatorProfileId: access.profile.id, listingId, rateId });
  if (result.ok) refreshConsole();
  return toState(result);
}

export async function addBlackoutAction(listingId: string, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await addBlackout({
    operatorProfileId: access.profile.id,
    listingId,
    startDate: text(form, "startDate"),
    endDate: text(form, "endDate"),
    reason: text(form, "reason") || null,
  });
  if (result.ok) refreshConsole();
  return toState(result);
}

export async function removeBlackoutAction(listingId: string, blackoutId: string, _prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await removeBlackout({ operatorProfileId: access.profile.id, listingId, blackoutId });
  if (result.ok) refreshConsole();
  return toState(result);
}

export async function saveLogisticsAction(listingId: string, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const hours = int(form, "hours");
  const minutes = int(form, "minutes");
  const duration = hours === null && minutes === null ? null : (hours ?? 0) * 60 + (minutes ?? 0);
  const result = await saveLogistics({
    operatorProfileId: access.profile.id,
    listingId,
    durationMinutes: duration,
    meetingPoint: text(form, "meetingPoint") || null,
    confirmationNote: text(form, "confirmationNote") || null,
  });
  if (result.ok) refreshConsole();
  return toState(result);
}

// ---------------------------------------------------------------------------
// Departures
// ---------------------------------------------------------------------------

export async function setDepartureAction(listingId: string, at: number, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const capacity = int(form, "capacity");
  const result = await setDepartureOverride({
    listingId,
    departsAt: new Date(at),
    operatorProfileId: access.profile.id,
    closed: form.get("closed") === "on",
    capacity: capacity === null ? null : capacity,
    note: text(form, "note") || null,
  });
  if (!result.ok) return { status: "error", message: result.reason };
  refreshConsole();
  syncCalendarSoon(access.profile.id);
  return { status: "done", message: "Departure updated." };
}

export async function cancelDepartureAction(listingId: string, at: number, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  if (form.get("confirm") !== "on") return { status: "error", message: "Tick the box to confirm. Everyone on this departure will be cancelled." };

  const result = await cancelDeparture(
    { listingId, departsAt: new Date(at), operatorProfileId: access.profile.id, actor: access.account.email, reason: text(form, "reason") || "Weather" },
    railsPayments(),
  );
  if (!result.ok) return { status: "error", message: result.reason };
  refreshConsole();
  syncCalendarSoon(access.profile.id);
  if (result.failed.length > 0) {
    return { status: "error", message: `Cancelled ${result.cancelled}, but these need another try: ${result.failed.join("; ")}` };
  }
  return {
    status: "done",
    message: result.cancelled === 0
      ? "Departure cancelled. Nobody was booked on it."
      : `Departure cancelled. ${result.cancelled} ${result.cancelled === 1 ? "booking was" : "bookings were"} cancelled and emailed${result.refundedCents > 0 ? ", and every online payment refunded" : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export async function checkInAction(bookingId: string, reference: string, checkedIn: boolean): Promise<void> {
  const { access, failure } = await operator();
  if (failure) return;
  await setCheckedIn({ bookingId, operatorProfileId: access.profile.id, checkedIn, actor: access.account.email });
  refreshConsole();
}

export async function markCollectedAction(bookingId: string, reference: string, _prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const r = await markCollected({ bookingId, operatorProfileId: access.profile.id, actor: access.account.email });
  if (!r.ok) return { status: "error", message: r.reason };
  refreshConsole();
  syncCalendarSoon(access.profile.id);
  return { status: "done", message: "Marked as paid to you." };
}

export async function resendConfirmationAction(bookingId: string, reference: string, _prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const r = await resendConfirmation({ bookingId, operatorProfileId: access.profile.id, actor: access.account.email });
  if (!r.ok) return { status: "error", message: r.reason };
  refreshConsole();
  return { status: "done", message: "Confirmation sent again." };
}

export async function cancelBookingAction(bookingId: string, reference: string, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  if (form.get("confirm") !== "on") return { status: "error", message: "Tick the box to confirm the cancellation." };
  const r = await cancelBooking(
    { bookingId, operatorProfileId: access.profile.id, actor: access.account.email, reason: text(form, "reason") },
    railsPayments(),
  );
  if (!r.ok) return { status: "error", message: r.reason };
  refreshConsole();
  syncCalendarSoon(access.profile.id);
  return { status: "done", message: r.refundedCents > 0 ? "Cancelled and refunded in full. The guest has been emailed." : "Cancelled. The seats are back on sale." };
}

export async function createOperatorBookingAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;

  const listingId = text(form, "listingId");
  const at = Number(text(form, "at"));
  if (!listingId || !Number.isFinite(at) || at <= 0) return { status: "error", message: "Pick a departure.", field: "at" };

  const quantities: Record<string, number> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("qty:")) quantities[key.slice(4)] = Number(value) || 0;
  }
  const total = money(form, "total");

  const result = await createOperatorBooking({
    operatorProfileId: access.profile.id,
    listingId,
    departsAt: new Date(at),
    quantities,
    guests: int(form, "guests") ?? undefined,
    totalCents: total === null ? null : Math.round(total * 100),
    lead: { name: text(form, "leadName"), email: text(form, "leadEmail") || null, phone: text(form, "leadPhone") || null },
    notes: text(form, "notes") || null,
    paid: text(form, "payment") === "paid",
    sendConfirmation: form.get("sendConfirmation") === "on",
    sendWhatsApp: form.get("sendWhatsApp") === "on",
    phoneCountry: access.profile.country,
    actorEmail: access.account.email,
  });
  if (!result.ok) return { status: "error", message: result.reason };

  refreshConsole();
  syncCalendarSoon(access.profile.id);
  redirect(`/operator/bookings/${result.booking.reference}?created=1`);
}


// ---------------------------------------------------------------------------
// Google Calendar, WhatsApp and the calendar feed
// ---------------------------------------------------------------------------

export async function syncGoogleNowAction(_prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const api = googleCalendarApi();
  if (!api) return { status: "error", message: "Google Calendar is not set up on Bluepass yet." };
  try {
    const written = await syncOperatorCalendar(access.profile.id, { api });
    if (written.status === "needs_reconnect") return { status: "error", message: "Google needs you to reconnect before it will accept changes." };
    await refreshBusyBlocks(access.profile.id, { api });
    refreshConsole();
    return {
      status: "done",
      message: written.written + written.removed === 0 ? "Already up to date." : `Up to date. ${written.written + written.removed} ${written.written + written.removed === 1 ? "departure" : "departures"} written to Google.`,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Google did not respond. Try again in a minute." };
  }
}

export async function disconnectGoogleAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  if (form.get("confirm") !== "on") return { status: "error", message: "Tick the box to confirm." };
  await disconnectGoogle(access.profile.id, googleCalendarApi());
  refreshConsole();
  return { status: "done", message: "Disconnected. The Bluepass bookings calendar has been removed from your Google account." };
}

export async function setBusyCalendarAction(listingId: string, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const listing = await prisma.operatorListing.findUnique({ where: { id: listingId }, select: { operatorProfileId: true } });
  if (!listing || listing.operatorProfileId !== access.profile.id) return { status: "error", message: "That trip is not one of yours." };

  const calendarId = text(form, "calendarId") || null;
  const api = googleCalendarApi();
  if (calendarId) {
    const calendars = api ? await operatorCalendars(access.profile.id, api).catch(() => null) : null;
    if (!calendars?.some((c) => c.id === calendarId)) return { status: "error", message: "That calendar is not in your Google account any more." };
  }
  await prisma.operatorListing.update({ where: { id: listingId }, data: { busyCalendarId: calendarId } });
  if (api) await refreshBusyBlocks(access.profile.id, { api }).catch(() => undefined);
  refreshConsole();
  return {
    status: "done",
    message: calendarId ? "Done. Departures close whenever that calendar shows you busy." : "Done. Your Google calendar no longer closes departures.",
  };
}

export async function updateAlertsAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const hour = int(form, "digestHour");
  const data = {
    whatsappNewBooking: form.get("whatsappNewBooking") === "on",
    whatsappDailyDigest: form.get("whatsappDailyDigest") === "on",
    emailNewBooking: form.get("emailNewBooking") === "on",
    digestHour: hour !== null && hour >= 0 && hour <= 23 ? hour : 17,
  };
  await prisma.operatorRailsSettings.upsert({
    where: { operatorProfileId: access.profile.id },
    create: { operatorProfileId: access.profile.id, ...data },
    update: data,
  });
  refreshConsole();
  return { status: "done", message: "Saved." };
}

export async function newFeedLinkAction(_prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const calendarFeedToken = randomBytes(24).toString("base64url");
  await prisma.operatorRailsSettings.upsert({
    where: { operatorProfileId: access.profile.id },
    create: { operatorProfileId: access.profile.id, calendarFeedToken },
    update: { calendarFeedToken },
  });
  refreshConsole();
  return { status: "done", message: "New link made. The old one has stopped working; subscribe again with this one." };
}

export async function sendDepartureUpdateAction(listingId: string, at: number, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const message = text(form, "message");
  if (message.length < 5) return { status: "error", message: "Write the message your guests should get." };
  const listing = await prisma.operatorListing.findUnique({ where: { id: listingId }, select: { operatorProfileId: true } });
  if (!listing || listing.operatorProfileId !== access.profile.id) return { status: "error", message: "That trip is not one of yours." };

  const counts = await notifyDepartureUpdate({ operatorProfileId: access.profile.id, listingId, departsAt: new Date(at), message });
  refreshConsole();
  const sent = [
    counts.whatsapp ? `${counts.whatsapp} on WhatsApp` : null,
    counts.email ? `${counts.email} by email` : null,
  ].filter(Boolean).join(" and ");
  const unreached = counts.unreachable
    ? ` ${counts.unreachable} ${counts.unreachable === 1 ? "guest has" : "guests have"} no email or WhatsApp; call them from the list below.`
    : "";
  const failed = counts.failed
    ? ` ${counts.failed} ${counts.failed === 1 ? "message" : "messages"} could not be sent; the booking shows why.`
    : "";
  if (!sent) {
    return {
      status: "error",
      message: counts.failed
        ? `Nothing was delivered.${failed}${unreached}`
        : "Nobody on this departure left an email or opted in to WhatsApp. Call them from the list below.",
    };
  }
  return { status: "done", message: `Sent ${sent}.${failed}${unreached}` };
}


// ---------------------------------------------------------------------------
// Booking systems: Rezdy and FareHarbor
// ---------------------------------------------------------------------------

function fromChannel(result: ChannelResult): RailsActionState {
  return result.ok ? { status: "done", message: result.message } : { status: "error", message: result.message };
}

export async function connectRezdyAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await connectRezdy({ operatorProfileId: access.profile.id, accountEmail: access.account.email, address: text(form, "address") });
  refreshConsole();
  return fromChannel(result);
}

export async function syncRezdyAction(_prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await syncOperatorRezdy(access.profile.id);
  refreshConsole();
  return fromChannel(result);
}

export async function disconnectRezdyAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  if (form.get("confirm") !== "on") return { status: "error", message: "Tick the box to confirm." };
  const result = await disconnectRezdy(access.profile.id);
  refreshConsole();
  return fromChannel(result);
}

export async function rezdyAutoPublishAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await setRezdyAutoPublish(access.profile.id, form.get("autoPublish") === "on");
  refreshConsole();
  return fromChannel(result);
}

export async function connectFareHarborAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await connectFareHarbor({ operatorProfileId: access.profile.id, link: text(form, "link"), timezone: text(form, "timezone") || null });
  refreshConsole();
  return fromChannel(result);
}

export async function disconnectFareHarborAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  if (form.get("confirm") !== "on") return { status: "error", message: "Tick the box to confirm." };
  const result = await disconnectFareHarbor(access.profile.id);
  refreshConsole();
  return fromChannel(result);
}

export async function addFareHarborTripAction(_prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const hours = money(form, "hours");
  const result = await addFareHarborTrip({
    operatorProfileId: access.profile.id,
    link: text(form, "link"),
    title: text(form, "title"),
    region: text(form, "region"),
    description: text(form, "description"),
    heroImageUrl: text(form, "heroImageUrl") || undefined,
    priceFrom: text(form, "priceFrom"),
    currency: text(form, "currency") || undefined,
    durationMinutes: hours && Number.isFinite(hours) ? Math.round(hours * 60) : null,
    meetingPoint: text(form, "meetingPoint") || null,
    timezone: text(form, "timezone") || null,
  });
  refreshConsole();
  return fromChannel(result);
}

export async function linkFareHarborTripAction(listingId: string, _prev: RailsActionState, form: FormData): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await linkFareHarborTrip({ operatorProfileId: access.profile.id, listingId, link: text(form, "link") });
  refreshConsole();
  return fromChannel(result);
}

export async function unlinkFareHarborTripAction(listingId: string, _prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const result = await unlinkFareHarborTrip({ operatorProfileId: access.profile.id, listingId });
  refreshConsole();
  return fromChannel(result);
}

/**
 * Shows or hides a trip that comes from the operator's own booking system. Its content
 * and seats are theirs to change there; whether Bluepass sells it is theirs to change here.
 */
export async function setChannelTripLiveAction(listingId: string, live: boolean, _prev: RailsActionState): Promise<RailsActionState> {
  const { access, failure } = await operator();
  if (failure) return failure;
  const listing = await prisma.operatorListing.findUnique({ where: { id: listingId }, select: { operatorProfileId: true, channel: true, status: true, channelIssue: true } });
  if (!listing || listing.operatorProfileId !== access.profile.id || listing.channel === "NATIVE") {
    return { status: "error", message: "That trip is not one of your Rezdy or FareHarbor trips." };
  }
  if (listing.status === "ARCHIVED") return { status: "error", message: "Bluepass has taken this trip down. Reply to the email about it to bring it back." };
  await prisma.operatorListing.update({
    where: { id: listingId },
    data: live ? { status: "LIVE", publishedAt: new Date() } : { status: "DRAFT" },
  });
  refreshConsole();
  return {
    status: "done",
    message: live
      ? listing.channelIssue ? "Shown on Bluepass. It starts selling once the issue above is fixed." : "Selling on Bluepass."
      : "Hidden from Bluepass. Nothing changes in your booking system.",
  };
}
