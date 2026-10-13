import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { reserveSeats } from "@/lib/services/rails/bookings";
import {
  applyWhatsAppStatuses,
  liveNotifyDeps,
  notifyBookingConfirmed,
  notifyDepartureUpdate,
  sendDailyDigests,
  sendDueReminders,
} from "@/lib/services/rails/notify";
import { cleanParam, RAILS_TEMPLATES, renderExample, templateComponents } from "@/lib/services/rails/whatsapp-templates";
import { EARLY, fakeNotify, resetRailsTables, seedOperator, THURSDAY_8AM } from "@/lib/services/rails/test-fixtures";

beforeEach(async () => {
  await resetRailsTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * A paid online booking, confirmed by writing the row directly: the engine's own
 * confirmation would send its messages with the live senders and claim the dedupe keys
 * these tests want to watch.
 */
async function paidBooking(
  seeded: Awaited<ReturnType<typeof seedOperator>>,
  lead: { name: string; email?: string | null; phone?: string | null },
  whatsappOptIn: boolean,
  bookedAt = EARLY,
) {
  const r = await reserveSeats({
    listingId: seeded.listing.id, departsAt: THURSDAY_8AM, quantities: { [seeded.adult.id]: 2 },
    lead: { ...lead, email: lead.email ?? `${lead.name.split(" ")[0].toLowerCase()}@example.test` }, whatsappOptIn, source: "ONLINE", now: bookedAt,
  });
  if (!r.ok) throw new Error(r.reason);
  if (lead.email === null) await prisma.listingBooking.update({ where: { id: r.booking.id }, data: { leadEmail: null } });
  return prisma.listingBooking.update({
    where: { id: r.booking.id },
    data: { status: "CONFIRMED", paymentStatus: "PAID", paidAt: bookedAt, expiresAt: null, createdAt: bookedAt },
  });
}

describe("booking confirmations", () => {
  it("sends the guest and the operator each message once, however often it is asked", async () => {
    const seeded = await seedOperator();
    const booking = await paidBooking(seeded, { name: "Mia Torres", phone: "+61 411 204 118" }, true);
    const { deps, sent } = fakeNotify();

    await notifyBookingConfirmed(booking.id, { deps });
    await notifyBookingConfirmed(booking.id, { deps });

    expect(sent.map((m) => `${m.kind}:${m.kind === "whatsapp" ? m.template : m.to}`).sort()).toEqual([
      "email:mia@example.test",
      `email:${seeded.account.email}`,
      "whatsapp:bluepass_booking_confirmed",
      "whatsapp:bluepass_operator_new_booking",
    ]);

    const guestMessage = sent.find((m) => m.template === "bluepass_booking_confirmed")!;
    expect(guestMessage.to).toBe("61411204118");
    expect(guestMessage.components).toEqual([
      expect.objectContaining({
        type: "body",
        parameters: expect.arrayContaining([
          { type: "text", parameter_name: "guest_name", text: "Mia" },
          { type: "text", parameter_name: "when", text: "Thursday 16 July at 8:00am" },
          { type: "text", parameter_name: "meeting_point", text: "Marina Pier B, Cairns" },
        ]),
      }),
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: booking.guestToken }] },
    ]);

    const operatorMessage = sent.find((m) => m.template === "bluepass_operator_new_booking")!;
    expect(operatorMessage.to).toBe("61400000000");
    expect(JSON.stringify(operatorMessage.components)).toContain(`${seeded.listing.id}_${THURSDAY_8AM.getTime()}`);
    expect(JSON.stringify(operatorMessage.components)).toContain('"text":"2 of 12"');

    expect(await prisma.railsNotification.count({ where: { bookingId: booking.id, status: "SENT" } })).toBe(4);
  });

  it("never WhatsApps a guest who did not opt in", async () => {
    const seeded = await seedOperator();
    const booking = await paidBooking(seeded, { name: "Sam Okafor", phone: "+61 433 120 774" }, false);
    const { deps, sent } = fakeNotify();
    await notifyBookingConfirmed(booking.id, { deps, operator: false });
    expect(sent.map((m) => m.kind)).toEqual(["email"]);
  });

  it("drops the opt-in when the number has no country code, rather than guess one", async () => {
    const seeded = await seedOperator();
    const booking = await paidBooking(seeded, { name: "Ruby Nguyen", phone: "0455 019 862" }, true);
    expect(booking.whatsappOptIn).toBe(false);
  });

  it("records WhatsApp as skipped, not failed, until it is switched on", async () => {
    const seeded = await seedOperator();
    const booking = await paidBooking(seeded, { name: "Mia Torres", phone: "+61411204118" }, true);
    const { deps, sent } = fakeNotify({ whatsapp: false });
    await notifyBookingConfirmed(booking.id, { deps });
    expect(sent.every((m) => m.kind === "email")).toBe(true);
    const skipped = await prisma.railsNotification.findMany({ where: { channel: "WHATSAPP" } });
    expect(skipped.map((n) => n.status)).toEqual(["SKIPPED", "SKIPPED"]);
    expect(skipped[0].detail).toContain("not switched on");
  });

  it("records a WhatsApp Meta refuses as failed, with Meta's reason", async () => {
    const seeded = await seedOperator();
    const booking = await paidBooking(seeded, { name: "Mia Torres", phone: "+61411204118" }, true);
    await notifyBookingConfirmed(booking.id, { deps: fakeNotify({ failWhatsApp: true }).deps, operator: false });
    const failed = await prisma.railsNotification.findFirstOrThrow({ where: { channel: "WHATSAPP" } });
    expect(failed).toMatchObject({ status: "FAILED", detail: expect.stringContaining("131026") });
  });

  it("respects the operator turning alerts off", async () => {
    const seeded = await seedOperator();
    await prisma.operatorRailsSettings.create({ data: { operatorProfileId: seeded.profile.id, whatsappNewBooking: false, emailNewBooking: false } });
    const booking = await paidBooking(seeded, { name: "Mia Torres" }, false);
    const { deps, sent } = fakeNotify();
    await notifyBookingConfirmed(booking.id, { deps });
    expect(sent.map((m) => m.to)).toEqual(["mia@example.test"]);
  });
});

describe("reminders and the evening summary", () => {
  it("reminds once, the day before, on the guest's chosen channel", async () => {
    const seeded = await seedOperator();
    await paidBooking(seeded, { name: "Mia Torres", phone: "+61411204118" }, true);
    await paidBooking(seeded, { name: "Sam Okafor" }, false);
    const { deps, sent } = fakeNotify();
    const dayBefore = new Date(THURSDAY_8AM.getTime() - 24 * 3_600_000);

    expect(await sendDueReminders(dayBefore, deps)).toMatchObject({ due: 2, sent: 2 });
    expect(await sendDueReminders(new Date(dayBefore.getTime() + 3_600_000), deps)).toMatchObject({ sent: 0 });
    expect(sent.map((m) => (m.kind === "whatsapp" ? m.template : m.subject))).toEqual([
      "bluepass_trip_reminder",
      "Tomorrow: Outer Reef Snorkel Day",
    ]);
    expect(JSON.stringify(sent[0].components)).toContain("tomorrow at 8:00am");
  });

  it("does not remind a guest who booked within the last day and a half", async () => {
    const seeded = await seedOperator();
    const lastMinute = new Date(THURSDAY_8AM.getTime() - 26 * 3_600_000);
    const r = await reserveSeats({
      listingId: seeded.listing.id, departsAt: THURSDAY_8AM, quantities: { [seeded.adult.id]: 1 },
      lead: { name: "Late Booker", email: "late@example.test" }, source: "ONLINE", now: lastMinute,
    });
    if (!r.ok) throw new Error(r.reason);
    await prisma.listingBooking.update({ where: { id: r.booking.id }, data: { status: "CONFIRMED", createdAt: lastMinute } });
    expect(await sendDueReminders(new Date(THURSDAY_8AM.getTime() - 24 * 3_600_000), fakeNotify().deps)).toMatchObject({ sent: 0 });
  });

  it("sends tomorrow's summary at five on the operator's clock, once", async () => {
    const seeded = await seedOperator();
    await paidBooking(seeded, { name: "Mia Torres" }, false);
    await paidBooking(seeded, { name: "James Whitfield" }, false);
    const { deps, sent } = fakeNotify();
    // 17:00 in Brisbane on Wednesday 15 July is 07:00 UTC.
    const fivePm = new Date("2026-07-15T07:00:00Z");

    expect(await sendDailyDigests(new Date("2026-07-15T06:00:00Z"), deps)).toMatchObject({ sent: 0 });
    expect(await sendDailyDigests(fivePm, deps)).toMatchObject({ sent: 1 });
    expect(await sendDailyDigests(new Date(fivePm.getTime() + 60_000), deps)).toMatchObject({ sent: 0 });

    const body = sent[0].components as { parameters: { parameter_name: string; text: string }[] }[];
    expect(body[0].parameters).toEqual([
      { type: "text", parameter_name: "date", text: "Thursday 16 July" },
      { type: "text", parameter_name: "departures", text: "Outer Reef Snorkel Day 8:00am, 4 guests" },
      { type: "text", parameter_name: "total_guests", text: "4 guests" },
    ]);
  });
});

describe("messages from the operator to everyone on a departure", () => {
  it("uses WhatsApp where the guest opted in, email otherwise, and counts who it cannot reach", async () => {
    const seeded = await seedOperator();
    await paidBooking(seeded, { name: "Mia Torres", phone: "+61411204118" }, true);
    await paidBooking(seeded, { name: "Sam Okafor" }, false);
    await paidBooking(seeded, { name: "No Contact", email: null }, false);
    const { deps, sent } = fakeNotify();
    const update = { operatorProfileId: seeded.profile.id, listingId: seeded.listing.id, departsAt: THURSDAY_8AM, message: "We leave from Pier C.\nSame time." };

    expect(await notifyDepartureUpdate(update, deps)).toEqual({ whatsapp: 1, email: 1, unreachable: 1, failed: 0 });
    expect(JSON.stringify(sent[0].components)).toContain("We leave from Pier C. Same time.");
    await notifyDepartureUpdate(update, deps);
    expect(sent).toHaveLength(2);
  });
});

describe("delivery receipts", () => {
  it("moves a message forward to delivered and read, never back", async () => {
    const seeded = await seedOperator();
    const booking = await paidBooking(seeded, { name: "Mia Torres", phone: "+61411204118" }, true);
    await notifyBookingConfirmed(booking.id, { deps: fakeNotify().deps, operator: false });
    const row = await prisma.railsNotification.findFirstOrThrow({ where: { channel: "WHATSAPP" } });
    const receipt = (status: string, ts: number) => ({
      entry: [{ changes: [{ value: { statuses: [{ id: row.providerMessageId, status, timestamp: String(ts) }] } }] }],
    });

    await applyWhatsAppStatuses(receipt("read", 1_784_000_100));
    await applyWhatsAppStatuses(receipt("delivered", 1_784_000_050));
    expect(await prisma.railsNotification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "READ",
      readAt: new Date(1_784_000_100_000),
    });
  });

  it("records why WhatsApp could not deliver", async () => {
    const seeded = await seedOperator();
    const booking = await paidBooking(seeded, { name: "Mia Torres", phone: "+61411204118" }, true);
    await notifyBookingConfirmed(booking.id, { deps: fakeNotify().deps, operator: false });
    const row = await prisma.railsNotification.findFirstOrThrow({ where: { channel: "WHATSAPP" } });
    await applyWhatsAppStatuses({
      entry: [{ changes: [{ value: { statuses: [{ id: row.providerMessageId, status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }],
    });
    expect(await prisma.railsNotification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "FAILED",
      detail: "Message undeliverable",
    });
  });
});

describe("templates", () => {
  it("flattens values WhatsApp would reject and never sends an empty one", () => {
    expect(cleanParam("note", "Bring a towel.\n\nAnd a hat.\t", "x")).toBe("Bring a towel. And a hat.");
    expect(cleanParam("meeting_point", "   ", "the meeting point on your booking page")).toBe("the meeting point on your booking page");
    expect(cleanParam("trip", "x".repeat(200), "y")).toHaveLength(120);
  });

  it("refuses to build a send with a variable missing, rather than let Meta reject it", () => {
    expect(() => templateComponents(RAILS_TEMPLATES.bookingCancelled, { guest_name: "Mia" })).toThrow(/missing/);
    expect(() => templateComponents(RAILS_TEMPLATES.bookingConfirmed, RAILS_TEMPLATES.bookingConfirmed.example)).toThrow(/link button/);
  });

  it("never starts or ends a body on a variable, and never puts two side by side", () => {
    for (const t of Object.values(RAILS_TEMPLATES)) {
      expect(t.body.trim()).not.toMatch(/^\{\{/);
      expect(t.body.trim()).not.toMatch(/\}\}[.!?]?$/);
      expect(t.body).not.toMatch(/\}\}\s*\{\{/);
      expect(t.body).not.toMatch(/—/);
      expect(renderExample(t)).not.toContain("{{");
      expect(new Set(t.body.match(/\{\{(\w+)\}\}/g)?.map((v) => v.slice(2, -2)))).toEqual(new Set(t.params));
    }
  });
});

describe("the live WhatsApp sender", () => {
  it("hands Meta named variables and the link button through the existing client", async () => {
    vi.stubEnv("WHATSAPP_RAILS_ENABLED", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("META_GRAPH_VERSION", "v20.0");
    vi.stubEnv("WHATSAPP_PHONE_ID_KAI", "PHONE_KAI");
    vi.stubEnv("WHATSAPP_PHONE_ID_OPS", "PHONE_OPS");
    const requests: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.LIVE" }] }), { status: 200 });
    });
    try {
      const deps = liveNotifyDeps();
      const t = RAILS_TEMPLATES.bookingConfirmed;
      const result = await deps.whatsapp!({ to: "61411204118", template: t, components: templateComponents(t, t.example, "tok123") });
      expect(result.providerMessageId).toBe("wamid.LIVE");
      expect(requests[0].url).toBe("https://graph.facebook.com/v20.0/PHONE_KAI/messages");
      expect(requests[0].body).toEqual({
        messaging_product: "whatsapp",
        to: "61411204118",
        type: "template",
        template: {
          name: "bluepass_booking_confirmed",
          language: { code: "en" },
          components: [
            { type: "body", parameters: t.params.map((p) => ({ type: "text", parameter_name: p, text: t.example[p as keyof typeof t.example] })) },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "tok123" }] },
          ],
        },
      });

      const ops = RAILS_TEMPLATES.operatorDigest;
      await deps.whatsapp!({ to: "61400000000", template: ops, components: templateComponents(ops, ops.example) });
      expect(requests[1].url).toBe("https://graph.facebook.com/v20.0/PHONE_OPS/messages");
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("is switched off until every setting it needs is present", () => {
    expect(liveNotifyDeps().whatsapp).toBeNull();
  });
});
