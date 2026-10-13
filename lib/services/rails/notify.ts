import { createHash } from "node:crypto";
import { Prisma, type RailsNotificationAudience, type RailsNotificationChannel } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sendAuthEmail } from "@/lib/services/auth/email";
import { addDays, localDateInZone, type PricedLine } from "@/lib/services/operators/listing-availability";
import { manifestPath } from "@/lib/services/rails/calendar-events";
import {
  cancellationEmail,
  confirmationEmail,
  departureUpdateEmail,
  operatorAlertEmail,
  reminderEmail,
  requestedEmail,
  type EmailBooking,
  type EmailContent,
  type EmailListing,
} from "@/lib/services/rails/emails";
import { formatClock, formatWhen, formatWhenRelative, localHour } from "@/lib/services/rails/format";
import { partyText } from "@/lib/services/rails/labels";
import { siteUrl, whatsappDigits } from "@/lib/services/rails/links";
import { formatMoney } from "@/lib/services/rails/money";
import {
  cleanParam,
  RAILS_TEMPLATES,
  templateComponents,
  type RailsTemplate,
} from "@/lib/services/rails/whatsapp-templates";
import { sendTemplateMessage, type WhatsAppTemplateComponent } from "@/lib/services/whatsapp/client";

/**
 * Every message the booking CMS sends, by email or WhatsApp, to a guest or an
 * operator. One place, so that each message is:
 *
 * - sent once. A dedupe key is claimed in the database before anything is sent; a
 *   second attempt (a Stripe webhook retried, an hourly sweep, a double click) finds
 *   the claim and stops. The key is the message's identity: one confirmation per
 *   booking per channel, one reminder, one evening summary per operator per day.
 * - recorded. Each row carries its delivery status, which Meta's webhook advances
 *   from sent to delivered to read, so an operator can see the guest got it.
 * - harmless when it fails. A message is a courtesy about a booking, never the
 *   booking itself; nothing here can undo a seat or a payment.
 *
 * WhatsApp is used only for a guest who opted in on the booking page, or whose
 * operator ticked it for a phone booking, and only from approved templates. Until
 * WHATSAPP_RAILS_ENABLED is set (after Meta approves them), WhatsApp messages are
 * recorded as skipped and email carries on alone.
 */

export type WhatsAppSend = (input: {
  to: string;
  template: RailsTemplate;
  components: WhatsAppTemplateComponent[];
}) => Promise<{ providerMessageId: string | null }>;

export type EmailSend = (input: { to: string } & EmailContent) => Promise<{ delivered: boolean; reason?: string }>;

export type NotifyDeps = { whatsapp: WhatsAppSend | null; email: EmailSend };

export function whatsappSwitchedOn(env: Record<string, string | undefined> = process.env) {
  return (
    env.WHATSAPP_RAILS_ENABLED === "true" &&
    Boolean(env.WHATSAPP_ACCESS_TOKEN?.trim()) &&
    Boolean(env.META_GRAPH_VERSION?.trim()) &&
    Boolean(env.WHATSAPP_PHONE_ID_KAI?.trim() || env.WHATSAPP_PHONE_ID_OPS?.trim())
  );
}

export function liveNotifyDeps(): NotifyDeps {
  return {
    whatsapp: whatsappSwitchedOn()
      ? ({ to, template, components }) =>
          sendTemplateMessage({ to, name: template.name, languageCode: template.language, role: template.sender, components })
      : null,
    email: async ({ to, subject, html, text }) => {
      const result = await sendAuthEmail({ to, subject, html, text });
      if (result.delivered) return { delivered: true };
      // The sender's own reason names an environment variable; an operator reads this one.
      return { delivered: false, reason: /RESEND_API_KEY/.test(result.reason) ? "Email sending is not set up yet." : result.reason };
    },
  };
}

// ---------------------------------------------------------------------------
// Sending once, and writing it down
// ---------------------------------------------------------------------------

type Envelope = {
  dedupeKey: string;
  operatorProfileId: string;
  bookingId: string | null;
  audience: RailsNotificationAudience;
  kind: string;
};

export type DeliveryOutcome = "sent" | "skipped" | "failed" | "duplicate";

async function claim(envelope: Envelope, channel: RailsNotificationChannel, recipient: string, skipped?: string) {
  try {
    const row = await prisma.railsNotification.create({
      data: { ...envelope, channel, recipient, status: skipped ? "SKIPPED" : "QUEUED", detail: skipped ?? null },
    });
    return row.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

async function deliverEmail(envelope: Envelope, to: string, email: EmailContent, deps: NotifyDeps): Promise<DeliveryOutcome> {
  const id = await claim(envelope, "EMAIL", to);
  if (!id) return "duplicate";
  try {
    const result = await deps.email({ to, ...email });
    await prisma.railsNotification.update({
      where: { id },
      data: result.delivered
        ? { status: "SENT", sentAt: new Date() }
        : { status: "SKIPPED", detail: result.reason?.slice(0, 300) ?? "Email is not configured." },
    });
    return result.delivered ? "sent" : "skipped";
  } catch (error) {
    await prisma.railsNotification.update({ where: { id }, data: { status: "FAILED", detail: errorText(error) } });
    return "failed";
  }
}

async function deliverWhatsApp(
  envelope: Envelope,
  phone: string | null,
  template: RailsTemplate,
  params: Record<string, string>,
  buttonValue: string | undefined,
  deps: NotifyDeps,
): Promise<DeliveryOutcome> {
  const digits = whatsappDigits(phone);
  if (!deps.whatsapp) {
    return (await claim(envelope, "WHATSAPP", phone ?? "", "WhatsApp messages are not switched on yet.")) ? "skipped" : "duplicate";
  }
  if (!digits) {
    return (await claim(envelope, "WHATSAPP", phone ?? "", "No WhatsApp number with a country code.")) ? "skipped" : "duplicate";
  }
  const id = await claim(envelope, "WHATSAPP", `+${digits}`);
  if (!id) return "duplicate";
  try {
    const { providerMessageId } = await deps.whatsapp({ to: digits, template, components: templateComponents(template, params, buttonValue) });
    await prisma.railsNotification.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), providerMessageId } });
    return "sent";
  } catch (error) {
    await prisma.railsNotification.update({ where: { id }, data: { status: "FAILED", detail: errorText(error) } });
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// What a message needs to know about a booking
// ---------------------------------------------------------------------------

async function loadBooking(bookingId: string) {
  const b = await prisma.listingBooking.findUnique({
    where: { id: bookingId },
    include: {
      listing: { select: { slug: true, title: true, meetingPoint: true, confirmationNote: true, durationMinutes: true } },
      operatorProfile: {
        select: { companyName: true, whatsappE164: true, payoutContactEmail: true, account: { select: { email: true } } },
      },
    },
  });
  if (!b) return null;
  const booking: EmailBooking = {
    reference: b.reference,
    departsAt: b.departsAt,
    timezone: b.timezone,
    guests: b.guests,
    lines: b.lines as unknown as PricedLine[],
    totalCents: b.totalCents,
    currency: b.currency,
    conservationCents: b.conservationCents,
    leadName: b.leadName,
    leadEmail: b.leadEmail,
    leadPhone: b.leadPhone,
    notes: b.notes,
    source: b.source,
    guestToken: b.guestToken,
    paymentStatus: b.paymentStatus,
    externalReference: b.externalReference,
  };
  const listing: EmailListing = {
    slug: b.listing.slug,
    title: b.listing.title,
    meetingPoint: b.listing.meetingPoint,
    confirmationNote: b.listing.confirmationNote,
    durationMinutes: b.listing.durationMinutes,
    operatorName: b.operatorProfile.companyName ?? "Your operator",
    operatorWhatsapp: b.operatorProfile.whatsappE164,
  };
  return {
    row: b,
    booking,
    listing,
    operator: {
      whatsapp: b.operatorProfile.whatsappE164,
      email: b.operatorProfile.payoutContactEmail ?? b.operatorProfile.account.email,
    },
  };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

export async function notificationSettings(operatorProfileId: string) {
  const settings = await prisma.operatorRailsSettings.findUnique({ where: { operatorProfileId } });
  return {
    whatsappNewBooking: settings?.whatsappNewBooking ?? true,
    whatsappDailyDigest: settings?.whatsappDailyDigest ?? true,
    emailNewBooking: settings?.emailNewBooking ?? true,
    digestHour: settings?.digestHour ?? 17,
  };
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

/** "10 of 14": confirmed guests on the departure against what it holds. */
async function fillText(m: Loaded) {
  const [booked, schedule, override] = await Promise.all([
    prisma.listingBooking.aggregate({
      where: { listingId: m.row.listingId, departsAt: m.row.departsAt, status: "CONFIRMED" },
      _sum: { guests: true },
    }),
    m.row.scheduleId ? prisma.listingSchedule.findUnique({ where: { id: m.row.scheduleId }, select: { capacityPerDeparture: true } }) : null,
    prisma.listingDepartureOverride.findUnique({
      where: { listingId_departsAt: { listingId: m.row.listingId, departsAt: m.row.departsAt } },
      select: { capacity: true },
    }),
  ]);
  const guests = booked._sum.guests ?? 0;
  const capacity = override?.capacity ?? schedule?.capacityPerDeparture;
  return capacity ? `${guests} of ${capacity}` : `${guests} guests`;
}

// ---------------------------------------------------------------------------
// The messages
// ---------------------------------------------------------------------------

/**
 * A booking is confirmed: the guest's confirmation, and the operator's new-booking
 * alert. A booking the operator entered themselves does not alert them about it.
 */
function confirmationParams(m: Loaded) {
  return {
    guest_name: cleanParam("guest_name", firstName(m.booking.leadName), "there"),
    trip: cleanParam("trip", m.listing.title, "your trip"),
    operator: cleanParam("operator", m.listing.operatorName, "your operator"),
    when: cleanParam("when", formatWhen(m.booking.departsAt, m.booking.timezone), "the date you chose"),
    guests: cleanParam("guests", partyText(m.booking.lines as PricedLine[], m.booking.guests), `${m.booking.guests} guests`),
    meeting_point: cleanParam("meeting_point", m.listing.meetingPoint, "the meeting point on your booking page"),
    reference: m.booking.reference,
  };
}

export async function notifyBookingConfirmed(
  bookingId: string,
  opts: {
    traveller?: boolean;
    operator?: boolean;
    /** For a phone booking, the operator chooses which of these the guest gets. */
    channels?: { email?: boolean; whatsapp?: boolean };
    deps?: NotifyDeps;
  } = {},
) {
  const deps = opts.deps ?? liveNotifyDeps();
  const m = await loadBooking(bookingId);
  if (!m || m.row.status !== "CONFIRMED") return [];
  const base = { operatorProfileId: m.row.operatorProfileId, bookingId: m.row.id };
  const tasks: Promise<DeliveryOutcome>[] = [];

  if (opts.traveller !== false) {
    const envelope = { ...base, audience: "TRAVELLER" as const, kind: "booking_confirmed" };
    if (m.booking.leadEmail && opts.channels?.email !== false) {
      tasks.push(deliverEmail({ ...envelope, dedupeKey: `booking_confirmed:email:${m.row.id}` }, m.booking.leadEmail, confirmationEmail(m.booking, m.listing), deps));
    }
    if (m.row.whatsappOptIn && opts.channels?.whatsapp !== false) {
      tasks.push(deliverWhatsApp(
        { ...envelope, dedupeKey: `booking_confirmed:whatsapp:${m.row.id}` },
        m.booking.leadPhone, RAILS_TEMPLATES.bookingConfirmed, confirmationParams(m), m.row.guestToken ?? undefined, deps,
      ));
    }
  }

  if (opts.operator !== false && m.row.source !== "OPERATOR") {
    const settings = await notificationSettings(m.row.operatorProfileId);
    const envelope = { ...base, audience: "OPERATOR" as const, kind: "operator_new_booking" };
    const manifestUrl = `${siteUrl()}${manifestPath(m.row.listingId, m.row.departsAt)}`;
    if (settings.emailNewBooking && m.operator.email) {
      tasks.push(deliverEmail({ ...envelope, dedupeKey: `operator_new_booking:email:${m.row.id}` }, m.operator.email, operatorAlertEmail(m.booking, m.listing, manifestUrl), deps));
    }
    if (settings.whatsappNewBooking && m.operator.whatsapp) {
      const t = RAILS_TEMPLATES.operatorNewBooking;
      const lead = m.booking.leadPhone ? `${m.booking.leadName} (${m.booking.leadPhone})` : m.booking.leadName;
      tasks.push(deliverWhatsApp({ ...envelope, dedupeKey: `operator_new_booking:whatsapp:${m.row.id}` }, m.operator.whatsapp, t, {
        trip: cleanParam("trip", m.listing.title, "your trip"),
        when: cleanParam("when", formatWhen(m.booking.departsAt, m.booking.timezone), "the booked date"),
        guests: cleanParam("guests", `${m.booking.guests} ${m.booking.guests === 1 ? "guest" : "guests"}`, "guests"),
        lead_guest: cleanParam("lead_guest", lead, "the lead guest"),
        booked: await fillText(m),
      }, `${m.row.listingId}_${m.row.departsAt.getTime()}`, deps));
    }
  }

  return Promise.all(tasks);
}

/**
 * Paid, and waiting for the operator to accept it in their own booking system. The
 * guest is told it is in and that they will hear the moment it is accepted. The
 * operator hears from their own system, which always notifies them; Bluepass's
 * "new booking" alert waits until there is a booking.
 */
export async function notifyBookingRequested(bookingId: string, deps: NotifyDeps = liveNotifyDeps()) {
  const m = await loadBooking(bookingId);
  if (!m || m.row.status !== "REQUESTED" || !m.booking.leadEmail) return [];
  const envelope = { operatorProfileId: m.row.operatorProfileId, bookingId: m.row.id, audience: "TRAVELLER" as const, kind: "booking_requested" };
  return [await deliverEmail({ ...envelope, dedupeKey: `booking_requested:email:${m.row.id}` }, m.booking.leadEmail, requestedEmail(m.booking, m.listing), deps)];
}

/**
 * The operator moved a booking to another time in their own system. The guest hears
 * the new time the way they chose to hear about this booking.
 */
export async function notifyBookingMoved(bookingId: string, previous: Date, deps: NotifyDeps = liveNotifyDeps()) {
  const m = await loadBooking(bookingId);
  if (!m || (m.row.status !== "CONFIRMED" && m.row.status !== "REQUESTED")) return [];
  const message = `Your booking has moved from ${formatWhen(previous, m.booking.timezone)} to ${formatWhen(m.booking.departsAt, m.booking.timezone)}.`;
  const key = `${m.row.id}:${m.booking.departsAt.getTime()}`;
  const envelope = { operatorProfileId: m.row.operatorProfileId, bookingId: m.row.id, audience: "TRAVELLER" as const, kind: "booking_moved" };
  if (m.row.whatsappOptIn && whatsappDigits(m.booking.leadPhone) && deps.whatsapp) {
    const outcome = await deliverWhatsApp({ ...envelope, dedupeKey: `booking_moved:whatsapp:${key}` }, m.booking.leadPhone, RAILS_TEMPLATES.departureUpdate, {
      guest_name: cleanParam("guest_name", firstName(m.booking.leadName), "there"),
      operator: cleanParam("operator", m.listing.operatorName, "your operator"),
      trip: cleanParam("trip", m.listing.title, "your trip"),
      when: cleanParam("when", formatWhen(m.booking.departsAt, m.booking.timezone), "your new time"),
      message: cleanParam("message", message, "Please check your booking page for the new time."),
    }, m.row.guestToken ?? undefined, deps);
    if (outcome === "sent" || outcome === "duplicate") return [outcome];
  }
  if (!m.booking.leadEmail) return [];
  return [await deliverEmail({ ...envelope, dedupeKey: `booking_moved:email:${key}` }, m.booking.leadEmail, departureUpdateEmail(m.booking, m.listing, message), deps)];
}

/** The operator pressed "Resend confirmation": sent again on purpose, so not deduplicated. */
export async function resendTravellerConfirmation(bookingId: string, deps: NotifyDeps = liveNotifyDeps()) {
  const m = await loadBooking(bookingId);
  if (!m || m.row.status !== "CONFIRMED") return [];
  const stamp = Date.now();
  const envelope = { operatorProfileId: m.row.operatorProfileId, bookingId: m.row.id, audience: "TRAVELLER" as const, kind: "booking_confirmed" };
  const tasks: Promise<DeliveryOutcome>[] = [];
  if (m.booking.leadEmail) {
    tasks.push(deliverEmail({ ...envelope, dedupeKey: `booking_confirmed:email:${m.row.id}:${stamp}` }, m.booking.leadEmail, confirmationEmail(m.booking, m.listing), deps));
  }
  if (m.row.whatsappOptIn) {
    tasks.push(deliverWhatsApp(
      { ...envelope, dedupeKey: `booking_confirmed:whatsapp:${m.row.id}:${stamp}` },
      m.booking.leadPhone, RAILS_TEMPLATES.bookingConfirmed, confirmationParams(m), m.row.guestToken ?? undefined, deps,
    ));
  }
  return Promise.all(tasks);
}

export async function notifyBookingCancelled(
  bookingId: string,
  detail: { reason: string; refundedCents: number },
  deps: NotifyDeps = liveNotifyDeps(),
) {
  const m = await loadBooking(bookingId);
  if (!m) return [];
  const envelope = { operatorProfileId: m.row.operatorProfileId, bookingId: m.row.id, audience: "TRAVELLER" as const, kind: "booking_cancelled" };
  const tasks: Promise<DeliveryOutcome>[] = [];
  if (m.booking.leadEmail) {
    tasks.push(deliverEmail({ ...envelope, dedupeKey: `booking_cancelled:email:${m.row.id}` }, m.booking.leadEmail, cancellationEmail(m.booking, m.listing, detail), deps));
  }
  if (m.row.whatsappOptIn) {
    tasks.push(deliverWhatsApp({ ...envelope, dedupeKey: `booking_cancelled:whatsapp:${m.row.id}` }, m.booking.leadPhone, RAILS_TEMPLATES.bookingCancelled, {
      guest_name: cleanParam("guest_name", firstName(m.booking.leadName), "there"),
      reference: m.booking.reference,
      trip: cleanParam("trip", m.listing.title, "your trip"),
      when: cleanParam("when", formatWhen(m.booking.departsAt, m.booking.timezone), "the booked date"),
      reason: cleanParam("reason", detail.reason.replace(/[.!\s]+$/, ""), "The operator cancelled the departure"),
      refund: cleanParam(
        "refund",
        detail.refundedCents > 0 ? `Your ${formatMoney(detail.refundedCents, m.booking.currency)} is on its way back to your card.` : "No payment was taken through Bluepass.",
        "No payment was taken through Bluepass.",
      ),
    }, undefined, deps));
  }
  return Promise.all(tasks);
}

/**
 * The day-before reminder, sent once between 18 and 30 hours ahead by an hourly run.
 * Skipped for a booking made within the last day and a half: its confirmation is
 * still fresh, and a second message so soon reads as noise.
 */
export async function sendDueReminders(now = new Date(), deps: NotifyDeps = liveNotifyDeps()) {
  const due = await prisma.listingBooking.findMany({
    where: {
      status: "CONFIRMED",
      departsAt: { gt: new Date(now.getTime() + 18 * 3_600_000), lte: new Date(now.getTime() + 30 * 3_600_000) },
    },
    select: { id: true, departsAt: true, createdAt: true },
  });
  let sent = 0;
  for (const b of due) {
    if (b.departsAt.getTime() - b.createdAt.getTime() < 36 * 3_600_000) continue;
    const m = await loadBooking(b.id);
    if (!m) continue;
    const envelope = { operatorProfileId: m.row.operatorProfileId, bookingId: m.row.id, audience: "TRAVELLER" as const, kind: "trip_reminder" };
    let outcome: DeliveryOutcome | null = null;
    if (m.row.whatsappOptIn && whatsappDigits(m.booking.leadPhone) && deps.whatsapp) {
      outcome = await deliverWhatsApp({ ...envelope, dedupeKey: `trip_reminder:whatsapp:${m.row.id}` }, m.booking.leadPhone, RAILS_TEMPLATES.tripReminder, {
        guest_name: cleanParam("guest_name", firstName(m.booking.leadName), "there"),
        when: cleanParam("when", formatWhenRelative(m.booking.departsAt, m.booking.timezone, now), "soon"),
        trip: cleanParam("trip", m.listing.title, "your trip"),
        meeting_point: cleanParam("meeting_point", m.listing.meetingPoint, "the meeting point on your booking page"),
        note: cleanParam("note", m.listing.confirmationNote, "Arrive a little early so the crew can check you in."),
        reference: m.booking.reference,
      }, m.row.guestToken ?? undefined, deps);
    } else if (m.booking.leadEmail) {
      outcome = await deliverEmail({ ...envelope, dedupeKey: `trip_reminder:email:${m.row.id}` }, m.booking.leadEmail, reminderEmail(m.booking, m.listing), deps);
    }
    if (outcome === "sent") sent += 1;
  }
  return { due: due.length, sent };
}

/**
 * The evening-before summary on WhatsApp: tomorrow's departures and who is coming,
 * at the hour the operator chose on their own clock. Nothing is sent on an evening
 * before a day with no bookings.
 */
export async function sendDailyDigests(now = new Date(), deps: NotifyDeps = liveNotifyDeps()) {
  const soon = await prisma.listingBooking.findMany({
    where: { status: "CONFIRMED", departsAt: { gt: now, lte: new Date(now.getTime() + 48 * 3_600_000) } },
    select: { operatorProfileId: true, listingId: true, departsAt: true, timezone: true, guests: true, listing: { select: { title: true } } },
    orderBy: { departsAt: "asc" },
  });
  const byOperator = new Map<string, typeof soon>();
  for (const b of soon) byOperator.set(b.operatorProfileId, [...(byOperator.get(b.operatorProfileId) ?? []), b]);

  let sent = 0;
  for (const [operatorProfileId, bookings] of byOperator) {
    const settings = await notificationSettings(operatorProfileId);
    if (!settings.whatsappDailyDigest) continue;
    const timezone = bookings[0].timezone;
    if (localHour(now, timezone) !== settings.digestHour) continue;

    const tomorrow = addDays(localDateInZone(now, timezone), 1);
    const tomorrows = bookings.filter((b) => localDateInZone(b.departsAt, b.timezone) === tomorrow);
    if (tomorrows.length === 0) continue;

    const profile = await prisma.operatorProfile.findUnique({ where: { id: operatorProfileId }, select: { whatsappE164: true } });
    if (!profile?.whatsappE164) continue;

    const departures = new Map<string, { title: string; at: Date; tz: string; guests: number }>();
    for (const b of tomorrows) {
      const key = `${b.listingId}|${b.departsAt.getTime()}`;
      const d = departures.get(key) ?? { title: b.listing.title, at: b.departsAt, tz: b.timezone, guests: 0 };
      d.guests += b.guests;
      departures.set(key, d);
    }
    const list = [...departures.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
    const total = list.reduce((n, d) => n + d.guests, 0);
    const summary = list.map((d) => `${d.title} ${formatClock(d.at, d.tz)}, ${d.guests} ${d.guests === 1 ? "guest" : "guests"}`).join("; ");

    const outcome = await deliverWhatsApp(
      { dedupeKey: `operator_daily_digest:whatsapp:${operatorProfileId}:${tomorrow}`, operatorProfileId, bookingId: null, audience: "OPERATOR", kind: "operator_daily_digest" },
      profile.whatsappE164,
      RAILS_TEMPLATES.operatorDigest,
      {
        date: cleanParam("date", new Intl.DateTimeFormat("en-AU", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(list[0].at), "tomorrow"),
        departures: cleanParam("departures", summary, "your departures"),
        total_guests: `${total} ${total === 1 ? "guest" : "guests"}`,
      },
      undefined,
      deps,
    );
    if (outcome === "sent") sent += 1;
  }
  return { operators: byOperator.size, sent };
}

/**
 * The operator's own message to everyone on a departure: running late, a new pier.
 * WhatsApp to guests who opted in, email to the rest, and a count of anyone neither
 * reaches so the operator knows to phone them.
 */
export async function notifyDepartureUpdate(
  input: { operatorProfileId: string; listingId: string; departsAt: Date; message: string },
  deps: NotifyDeps = liveNotifyDeps(),
) {
  const message = input.message.replace(/\s+/g, " ").trim().slice(0, 300);
  const digest = createHash("sha1").update(message).digest("hex").slice(0, 12);
  const bookings = await prisma.listingBooking.findMany({
    where: { operatorProfileId: input.operatorProfileId, listingId: input.listingId, departsAt: input.departsAt, status: "CONFIRMED" },
    select: { id: true },
  });
  const counts = { whatsapp: 0, email: 0, unreachable: 0, failed: 0 };
  for (const { id } of bookings) {
    const m = await loadBooking(id);
    if (!m) continue;
    const envelope = { operatorProfileId: m.row.operatorProfileId, bookingId: m.row.id, audience: "TRAVELLER" as const, kind: "departure_update" };
    if (m.row.whatsappOptIn && whatsappDigits(m.booking.leadPhone) && deps.whatsapp) {
      const outcome = await deliverWhatsApp({ ...envelope, dedupeKey: `departure_update:whatsapp:${m.row.id}:${digest}` }, m.booking.leadPhone, RAILS_TEMPLATES.departureUpdate, {
        guest_name: cleanParam("guest_name", firstName(m.booking.leadName), "there"),
        operator: cleanParam("operator", m.listing.operatorName, "your operator"),
        trip: cleanParam("trip", m.listing.title, "your trip"),
        when: cleanParam("when", formatWhen(m.booking.departsAt, m.booking.timezone), "your booked date"),
        message: cleanParam("message", message, "Please check your booking page for details."),
      }, m.row.guestToken ?? undefined, deps);
      if (outcome === "sent" || outcome === "duplicate") { counts.whatsapp += 1; continue; }
    }
    if (m.booking.leadEmail) {
      const outcome = await deliverEmail({ ...envelope, dedupeKey: `departure_update:email:${m.row.id}:${digest}` }, m.booking.leadEmail, departureUpdateEmail(m.booking, m.listing, message), deps);
      if (outcome === "sent" || outcome === "duplicate") counts.email += 1;
      else counts.failed += 1;
    } else {
      counts.unreachable += 1;
    }
  }
  return counts;
}

/**
 * Catches a confirmation that never went out: the server stopped between taking the
 * money and sending the email. Online and Kai bookings only; a phone booking's
 * confirmation is the operator's choice to send.
 */
export async function sweepMissedConfirmations(now = new Date(), deps: NotifyDeps = liveNotifyDeps()) {
  const missed = await prisma.listingBooking.findMany({
    where: {
      status: "CONFIRMED",
      source: { in: ["ONLINE", "KAI"] },
      paidAt: { gte: new Date(now.getTime() - 72 * 3_600_000), lte: new Date(now.getTime() - 10 * 60_000) },
      notifications: { none: { kind: "booking_confirmed" } },
    },
    select: { id: true },
    take: 100,
  });
  for (const { id } of missed) await notifyBookingConfirmed(id, { deps });
  return missed.length;
}

/** A claim left QUEUED by a send that never finished is released so the sweep can try again. */
export async function releaseStuckClaims(now = new Date()) {
  const { count } = await prisma.railsNotification.deleteMany({
    where: { status: "QUEUED", createdAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Delivery receipts
// ---------------------------------------------------------------------------

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

type MetaStatus = { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string }[] };

function statusesIn(payload: unknown): MetaStatus[] {
  const out: MetaStatus[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { statuses?: MetaStatus[] } }[] }[] })?.entry ?? [];
  for (const entry of entries) for (const change of entry.changes ?? []) out.push(...(change.value?.statuses ?? []));
  return out;
}

/**
 * Meta's delivery receipts for booking messages. Receipts arrive out of order, so a
 * status only ever moves forward: a late "delivered" never undoes a "read".
 */
export async function applyWhatsAppStatuses(payload: unknown) {
  let updated = 0;
  for (const s of statusesIn(payload)) {
    if (!s.id || !s.status) continue;
    const row = await prisma.railsNotification.findUnique({ where: { providerMessageId: s.id }, select: { id: true, status: true } });
    if (!row) continue;
    const at = s.timestamp && Number.isFinite(Number(s.timestamp)) ? new Date(Number(s.timestamp) * 1000) : new Date();
    if (s.status === "failed") {
      const reason = s.errors?.[0];
      await prisma.railsNotification.update({
        where: { id: row.id },
        data: { status: "FAILED", detail: [reason?.title, reason?.message].filter(Boolean).join(": ").slice(0, 300) || "WhatsApp could not deliver it." },
      });
      updated += 1;
      continue;
    }
    const next = s.status.toUpperCase();
    if (!(next in RANK) || (RANK[next] ?? 0) <= (RANK[row.status] ?? -1)) continue;
    await prisma.railsNotification.update({
      where: { id: row.id },
      data: {
        status: next as "SENT" | "DELIVERED" | "READ",
        ...(next === "DELIVERED" ? { deliveredAt: at } : {}),
        ...(next === "READ" ? { readAt: at } : {}),
      },
    });
    updated += 1;
  }
  return updated;
}
