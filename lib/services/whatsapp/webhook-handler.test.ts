/**
 * DB-backed tests for the WhatsApp operator loop: free-text commands, sender
 * ownership, ambiguity refusal and redelivery dedupe. Runs under
 * vitest.rails.config.ts (local Postgres only) - never the shared database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  handleWhatsAppWebhook,
  recoverStaleWhatsAppReceipts,
  type WhatsAppWebhookHandlerOptions,
} from "./webhook-handler";
import { phonesExactlyMatch } from "./operator-action-resolution";
import type { FreeTextMessage } from "./operator-dispatch";

const OPERATOR_PHONE = "6281234567001";
const STRANGER_PHONE = "6289999999999";

type FollowUp = { message: FreeTextMessage; to?: string };

function makeHarness() {
  const followUps: FollowUp[] = [];
  const errors: { event: string; details?: unknown }[] = [];
  const options: WhatsAppWebhookHandlerOptions = {
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: (event, details) => {
        errors.push({ event: String(event), details });
      },
    },
    onOperatorFollowUp: (message, context) => {
      followUps.push({ message, to: context.to });
    },
    // Tests drive recoverStaleWhatsAppReceipts directly so the piggybacked
    // sweep cannot race their fixtures.
    skipRecoverySweep: true,
  };
  return { followUps, errors, options };
}

function payloadWithMessage(message: Record<string, unknown>) {
  return { entry: [{ changes: [{ value: { messages: [message] } }] }] };
}

function textMessage(body: string, from = OPERATOR_PHONE, id?: string) {
  return { from, id: id ?? `wamid.${Math.random().toString(36).slice(2)}`, type: "text", text: { body } };
}

function buttonMessage(payload: string, from = OPERATOR_PHONE, id?: string) {
  return {
    from,
    id: id ?? `wamid.${Math.random().toString(36).slice(2)}`,
    type: "interactive",
    interactive: { button_reply: { id: payload, title: payload } },
  };
}

async function seedPendingInquiry(opts: { yacht?: string; status?: "READY_TO_DISPATCH" | "OPERATOR_PENDING" | "COUNTER_OFFERED" } = {}) {
  const inquiry = await prisma.bookingInquiry.create({
    data: {
      sourceChannel: "WHATSAPP",
      selectedYachtName: opts.yacht ?? "Calico Jack",
      dateWindow: "20 July 2026",
      guests: 2,
      status: opts.status ?? "OPERATOR_PENDING",
    },
  });
  await prisma.whatsAppOutboundMessage.create({
    data: {
      bookingInquiryId: inquiry.id,
      // Marker-preserving canonical storage, as the dispatch write path stores it.
      recipientPhone: `+${OPERATOR_PHONE}`,
      templateName: "booking_inquiry_operator",
      status: "SENT",
      sentAt: new Date(),
    },
  });
  return inquiry;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "WhatsAppInboundReceipt", "WhatsAppOutboundMessage", "BookingInquiryEvent", "BookingInquiry", "BookingEvent", "Booking", "Trip", "Traveller", "Operator" CASCADE`,
  );
});

describe("handleWhatsAppWebhook operator free-text commands", () => {
  it("accepts an inquiry by full id from the dispatched operator phone", async () => {
    const inquiry = await seedPendingInquiry();
    const { followUps, options } = makeHarness();

    await handleWhatsAppWebhook(payloadWithMessage(textMessage(`accept:${inquiry.id}`)), options);

    const updated = await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(updated.status).toBe("OPERATOR_ACCEPTED");
    const events = await prisma.bookingInquiryEvent.findMany({ where: { bookingInquiryId: inquiry.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "OPERATOR_PENDING", toStatus: "OPERATOR_ACCEPTED", actorType: "OPERATOR" });
    expect(followUps).toHaveLength(0);
  });

  it("records counter terms sent with the command and confirms receipt instead of prompting", async () => {
    const inquiry = await seedPendingInquiry();
    const { followUps, options } = makeHarness();

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`counter:${inquiry.id} Available 2 November instead, USD 4,100 total.`)),
      options,
    );

    const updated = await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(updated.status).toBe("COUNTER_OFFERED");
    const event = await prisma.bookingInquiryEvent.findFirstOrThrow({ where: { bookingInquiryId: inquiry.id } });
    expect((event.payload as Record<string, unknown>).counterText).toBe("Available 2 November instead, USD 4,100 total.");
    expect(followUps).toHaveLength(1);
    expect(followUps[0].message.body).toContain("Counter-offer recorded");
    expect(followUps[0].to).toBe(OPERATOR_PHONE);
  });

  it("resolves a unique id suffix among the sender's pending inquiries", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();

    await handleWhatsAppWebhook(payloadWithMessage(textMessage(`decline:${inquiry.id.slice(-6)}`)), options);

    const updated = await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(updated.status).toBe("OPERATOR_DECLINED");
  });

  it("resolves a bare command when exactly one inquiry is pending", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();

    await handleWhatsAppWebhook(payloadWithMessage(textMessage("accept")), options);

    const updated = await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(updated.status).toBe("OPERATOR_ACCEPTED");
  });

  it("refuses a bare command when two inquiries are pending, changing nothing", async () => {
    const first = await seedPendingInquiry({ yacht: "Calico Jack" });
    const second = await seedPendingInquiry({ yacht: "Alila Purnama" });
    const { followUps, options } = makeHarness();

    await handleWhatsAppWebhook(payloadWithMessage(textMessage("accept")), options);

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("OPERATOR_PENDING");
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("OPERATOR_PENDING");
    expect(followUps).toHaveLength(1);
    expect(followUps[0].message.body).toContain("2 pending inquiries");
    expect(followUps[0].message.body).toContain(first.id.slice(-6));
    expect(followUps[0].message.body).toContain(second.id.slice(-6));
  });

  it("silently refuses an action from a phone with no dispatch or operator context", async () => {
    const inquiry = await seedPendingInquiry();
    const { followUps, options } = makeHarness();

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`accept:${inquiry.id}`, STRANGER_PHONE)),
      options,
    );

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
    expect(followUps).toHaveLength(0);
  });

  it("answers an unknown reference with guidance and no mutation", async () => {
    const inquiry = await seedPendingInquiry();
    const { followUps, options } = makeHarness();

    await handleWhatsAppWebhook(payloadWithMessage(textMessage("accept:zzzzzz")), options);

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
    expect(followUps).toHaveLength(1);
    expect(followUps[0].message.body).toContain("could not find a pending inquiry");
  });

  it("skips a redelivered message by providerMessageId", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    const payload = payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.redelivered.1"));

    await handleWhatsAppWebhook(payload, options);
    await handleWhatsAppWebhook(payload, options);

    const events = await prisma.bookingInquiryEvent.findMany({ where: { bookingInquiryId: inquiry.id } });
    expect(events).toHaveLength(1);
    expect(await prisma.whatsAppInboundReceipt.count()).toBe(1);
  });

  it("acts exactly once when two deliveries of the same message race", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    const payload = payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.racing.1"));

    const results = await Promise.allSettled([
      handleWhatsAppWebhook(payload, options),
      handleWhatsAppWebhook(payload, options),
    ]);
    // The loser of the claim race gets a lease-in-flight rejection (route
    // answers non-200) rather than a 200 that could stop Meta's redelivery
    // before anything committed "processed". If the winner finished first,
    // the loser simply skips as a duplicate - so at most one rejection.
    expect(results.filter((r) => r.status === "rejected").length).toBeLessThanOrEqual(1);

    // Meta's redelivery after a non-200 finds the terminal receipt and skips.
    await handleWhatsAppWebhook(payload, options);

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
    const events = await prisma.bookingInquiryEvent.findMany({ where: { bookingInquiryId: inquiry.id } });
    expect(events).toHaveLength(1);
    expect(await prisma.whatsAppInboundReceipt.count()).toBe(1);
  });

  it("leaves a failed delivery eligible for Meta's retry", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    const payload = payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.fails.once"));

    // First delivery fails inside the action layer (status guard tripped by a
    // torn read), receipt removed; the retry processes normally.
    let calls = 0;
    const flakyOptions: WhatsAppWebhookHandlerOptions = {
      ...options,
      inquiryActions: {
        processOperatorInquiryAction: async (input) => {
          calls += 1;
          if (calls === 1) throw new Error("simulated transient failure");
          const { processOperatorInquiryAction } = await import("@/lib/services/booking/booking-inquiry-actions");
          return processOperatorInquiryAction(input);
        },
      },
    };

    // The handler must throw so the route answers non-200 - a 200 would tell
    // Meta "delivered" and the un-receipted message would never be retried.
    await expect(handleWhatsAppWebhook(payload, flakyOptions)).rejects.toThrow(/need Meta redelivery/);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
    expect(await prisma.whatsAppInboundReceipt.count()).toBe(0);

    await handleWhatsAppWebhook(payload, flakyOptions);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
    expect(await prisma.whatsAppInboundReceipt.count()).toBe(1);
  });

  it("reprocesses a message whose receipt was stranded by a crash (stale received lease)", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    await prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: "wamid.crashed.1",
        fromPhone: OPERATOR_PHONE,
        handler: "whatsapp.webhook",
        outcome: "received",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.crashed.1")),
      options,
    );

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
    expect((await prisma.whatsAppInboundReceipt.findUniqueOrThrow({ where: { providerMessageId: "wamid.crashed.1" } })).outcome).toBe("processed");
  });

  it("answers non-200 for a duplicate arriving while the first delivery is still in flight", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    await prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: "wamid.inflight.1",
        fromPhone: OPERATOR_PHONE,
        handler: "whatsapp.webhook",
        outcome: "received",
      },
    });
    const payload = payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.inflight.1"));

    // A 200 here would tell Meta "delivered" and could stop the redelivery
    // that is this message's only guaranteed retry before anything committed
    // "processed" - so the handler must throw (route answers non-200) and the
    // receipt must be left untouched for the in-flight delivery to settle.
    await expect(handleWhatsAppWebhook(payload, options)).rejects.toThrow(/in-flight lease/);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
    const receipt = await prisma.whatsAppInboundReceipt.findUniqueOrThrow({
      where: { providerMessageId: "wamid.inflight.1" },
    });
    expect(receipt.outcome).toBe("received");
    expect(receipt.attempts).toBe(0);

    // Once the first delivery commits "processed", the redelivery skips cleanly.
    await prisma.whatsAppInboundReceipt.update({
      where: { providerMessageId: "wamid.inflight.1" },
      data: { outcome: "processed" },
    });
    await handleWhatsAppWebhook(payload, options);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
  });

  it("does not reclaim a recently-touched received lease, even when created long ago", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    await prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: "wamid.recent.lease.1",
        fromPhone: OPERATOR_PHONE,
        handler: "whatsapp.webhook",
        outcome: "received",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 1000),
      },
    });

    // Claim and the recovery sweep judge the lease by the same clock
    // (updatedAt): a lease touched 10s ago is still owned, so the duplicate
    // must wait for Meta's redelivery (non-200), not reclaim and double-act.
    await expect(
      handleWhatsAppWebhook(
        payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.recent.lease.1")),
        options,
      ),
    ).rejects.toThrow(/in-flight lease/);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
  });

  it("lets exactly one of two racing deliveries reclaim a stale lease", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    await prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: "wamid.stale.race.1",
        fromPhone: OPERATOR_PHONE,
        handler: "whatsapp.webhook",
        outcome: "received",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    const payload = payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.stale.race.1"));

    const results = await Promise.allSettled([
      handleWhatsAppWebhook(payload, options),
      handleWhatsAppWebhook(payload, options),
    ]);
    // The loser either hits the compare-and-set lease (rejection -> non-200 ->
    // Meta redelivers) or skips as a duplicate if the winner already settled.
    expect(results.filter((r) => r.status === "rejected").length).toBeLessThanOrEqual(1);

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
    expect(await prisma.bookingInquiryEvent.count({ where: { bookingInquiryId: inquiry.id } })).toBe(1);
  });

  it("marks a foreign button payload as a terminal failed receipt, not a retry loop", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    const foreignButton = {
      from: OPERATOR_PHONE,
      id: "wamid.foreign.button.1",
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "some-other-app-action", title: "View order" },
      },
    };

    // Must NOT throw: a non-200 would make Meta redeliver a payload that can
    // never parse, forever, with no record of why.
    await handleWhatsAppWebhook(payloadWithMessage(foreignButton), options);

    const receipt = await prisma.whatsAppInboundReceipt.findUniqueOrThrow({
      where: { providerMessageId: "wamid.foreign.button.1" },
    });
    expect(receipt.outcome).toBe("failed");
    // At the attempt cap the recovery sweep never replays or requeues it.
    expect(receipt.attempts).toBe(5);
    // Contents scrubbed, same as a processed receipt.
    expect(receipt.payload).toBeNull();

    // Nothing else mutated, and Meta's redelivery of the same message is a
    // clean duplicate skip (still no throw, still no mutation).
    await handleWhatsAppWebhook(payloadWithMessage(foreignButton), options);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
    expect(await prisma.bookingInquiryEvent.count({ where: { bookingInquiryId: inquiry.id } })).toBe(0);
  });

  it("does not fabricate an ack for a new message rejected by the transition guard", async () => {
    const inquiry = await seedPendingInquiry();
    const { followUps, options } = makeHarness();

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.accept.1")),
      options,
    );
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");

    // A DIFFERENT message accepting again is not a proven replay: the guard
    // rejects it, and the error must propagate (route 500, receipt removed)
    // rather than being masked into a fake acknowledgement with a
    // manufactured status pair.
    await expect(
      handleWhatsAppWebhook(
        payloadWithMessage(textMessage(`accept:${inquiry.id}`, OPERATOR_PHONE, "wamid.accept.2")),
        options,
      ),
    ).rejects.toThrow(/need Meta redelivery/);
    expect(followUps).toHaveLength(0);
    expect(await prisma.whatsAppInboundReceipt.count({ where: { providerMessageId: "wamid.accept.2" } })).toBe(0);
    const events = await prisma.bookingInquiryEvent.findMany({ where: { bookingInquiryId: inquiry.id } });
    expect(events).toHaveLength(1);
  });

  it("recovers the acknowledgement when the state landed but the ack send failed", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();
    const payload = payloadWithMessage(
      textMessage(`counter:${inquiry.id} Available 2 November, USD 4,100.`, OPERATOR_PHONE, "wamid.ack.1"),
    );

    // First delivery: state commits, then the ack send blows up.
    const failingOptions: WhatsAppWebhookHandlerOptions = {
      ...options,
      onOperatorFollowUp: () => {
        throw new Error("Meta send failed");
      },
    };
    await expect(handleWhatsAppWebhook(payload, failingOptions)).rejects.toThrow(/need Meta redelivery/);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("COUNTER_OFFERED");

    // Meta's redelivery hits the transition guard - but the ack must still go out.
    const { followUps } = makeHarness();
    const retryOptions: WhatsAppWebhookHandlerOptions = {
      ...options,
      onOperatorFollowUp: (message, context) => {
        followUps.push({ message, to: context.to });
      },
    };
    await handleWhatsAppWebhook(payload, retryOptions);

    expect(followUps).toHaveLength(1);
    expect(followUps[0].message.body).toContain("Counter-offer recorded");
    const events = await prisma.bookingInquiryEvent.findMany({ where: { bookingInquiryId: inquiry.id } });
    expect(events).toHaveLength(1);
  });

  it("lets a genuinely new counter message revise terms (not a replay)", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`counter:${inquiry.id} First offer.`, OPERATOR_PHONE, "wamid.counter.1")),
      options,
    );
    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`counter:${inquiry.id} Revised offer, better boat.`, OPERATOR_PHONE, "wamid.counter.2")),
      options,
    );

    const events = await prisma.bookingInquiryEvent.findMany({
      where: { bookingInquiryId: inquiry.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect((events[1].payload as Record<string, unknown>).counterText).toBe("Revised offer, better boat.");
  });

  it("matches the operator across phone storage formats (local 04 vs Meta 614)", async () => {
    const inquiry = await seedPendingInquiry();
    await prisma.whatsAppOutboundMessage.updateMany({
      where: { bookingInquiryId: inquiry.id },
      data: { recipientPhone: "0412345678" },
    });
    const { options } = makeHarness();

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`accept:${inquiry.id}`, "61412345678")),
      options,
    );

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
  });

  it("denies a sender from another country whose national part matches (no suffix matching)", async () => {
    const inquiry = await seedPendingInquiry();
    await prisma.whatsAppOutboundMessage.updateMany({
      where: { bookingInquiryId: inquiry.id },
      data: { recipientPhone: "0412345678" },
    });
    const { options } = makeHarness();

    // +62 412-345-678 (Indonesia) shares the national digits of the stored
    // AU number 0412 345 678; country-free matching would authorize it.
    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage(`accept:${inquiry.id}`, "62412345678")),
      options,
    );

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
    expect(await prisma.bookingInquiryEvent.count()).toBe(0);
  });

  it("still handles quick-reply buttons with a structured payload", async () => {
    const inquiry = await seedPendingInquiry();
    const { options } = makeHarness();

    await handleWhatsAppWebhook(payloadWithMessage(buttonMessage(`accept:${inquiry.id}`)), options);

    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
  });

  it("ignores ordinary traveller conversation text when the traveller path is off", async () => {
    const { followUps, options } = makeHarness();

    await handleWhatsAppWebhook(payloadWithMessage(textMessage("hello, is the boat available?")), options);

    expect(await prisma.bookingInquiryEvent.count()).toBe(0);
    expect(followUps).toHaveLength(0);
  });
});

describe("handleWhatsAppWebhook traveller conversation (flag on)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "KaiMessage", "KaiSession" CASCADE`);
  });

  function fakeConversationService(reply: string) {
    const calls: Array<{ sessionId?: string; travellerPhone?: string; message: string }> = [];
    return {
      calls,
      service: {
        async handleUserMessage(input: { sessionId?: string; travellerPhone?: string; message: string }) {
          calls.push(input);
          return {
            sessionId: input.sessionId ?? `kai_test_${calls.length}`,
            reply,
            intent: {},
            messages: [],
          };
        },
      },
    };
  }

  it("answers a traveller text via the Kai service and threads the session by phone", async () => {
    const { options } = makeHarness();
    const replies: Array<{ body: string; to: string }> = [];
    const fake = fakeConversationService("Tell me about your dates!");
    const wired: WhatsAppWebhookHandlerOptions = {
      ...options,
      travellerConversationEnabled: true,
      travellerConversation: { conversationService: fake.service as never },
      onTravellerReply: (message, context) => {
        replies.push({ body: message.body, to: context.to });
      },
    };
    const session = await prisma.kaiSession.create({
      data: { channel: "WHATSAPP", travellerPhone: "6281000001234", status: "OPEN" },
    });

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage("hi, looking for a boat trip", "6281000001234")),
      wired,
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ sessionId: session.id, travellerPhone: "6281000001234" });
    expect(replies).toEqual([{ body: "Tell me about your dates!", to: "6281000001234" }]);
  });

  it("starts a fresh session when none is open for the phone", async () => {
    const { options } = makeHarness();
    const fake = fakeConversationService("Welcome aboard.");
    const wired: WhatsAppWebhookHandlerOptions = {
      ...options,
      travellerConversationEnabled: true,
      travellerConversation: { conversationService: fake.service as never },
      onTravellerReply: () => undefined,
    };

    await handleWhatsAppWebhook(
      payloadWithMessage(textMessage("hello", "6281000009999")),
      wired,
    );

    expect(fake.calls[0].sessionId).toBeUndefined();
  });

  it("stays silent when kai-core owns traveller conversation", async () => {
    const { options } = makeHarness();
    const fake = fakeConversationService("should not be sent");
    const wired: WhatsAppWebhookHandlerOptions = {
      ...options,
      travellerConversation: { conversationService: fake.service as never },
      onTravellerReply: () => {
        throw new Error("must not reply");
      },
    };
    process.env.KAI_CORE_ENABLED = "true";
    try {
      await handleWhatsAppWebhook(payloadWithMessage(textMessage("hello", "6281000005555")), wired);
    } finally {
      delete process.env.KAI_CORE_ENABLED;
    }

    expect(fake.calls).toHaveLength(0);
  });
});

describe("handleWhatsAppWebhook legacy booking button path", () => {
  it("applies a booking button from the owning operator only", async () => {
    const operator = await prisma.operator.create({
      data: { name: "Reef Runner", whatsappE164: "+61400000001" },
    });
    const trip = await prisma.trip.create({
      data: { operatorId: operator.id, title: "Reef Day", priceCents: 10000 },
    });
    const traveller = await prisma.traveller.create({ data: { whatsappE164: "+61422000000" } });
    const booking = await prisma.booking.create({
      data: {
        operatorId: operator.id,
        tripId: trip.id,
        travellerId: traveller.id,
        status: "OPERATOR_NOTIFIED",
        totalCents: 10000,
      },
    });
    const { options } = makeHarness();

    // A stranger pressing an accept button they somehow obtained changes nothing.
    await handleWhatsAppWebhook(payloadWithMessage(buttonMessage(`accept:${booking.id}`, STRANGER_PHONE)), options);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("OPERATOR_NOTIFIED");

    await handleWhatsAppWebhook(payloadWithMessage(buttonMessage(`accept:${booking.id}`, "61400000001")), options);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("OPERATOR_ACCEPTED");
  });
});

describe("recoverStaleWhatsAppReceipts (crash recovery without a Meta retry)", () => {
  const TEN_MINUTES_AGO = () => new Date(Date.now() - 10 * 60 * 1000);

  async function seedStrandedReceipt(opts: {
    id: string;
    inquiryId: string;
    outcome?: string;
    attempts?: number;
    updatedAt?: Date;
    withPayload?: boolean;
  }) {
    return prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: opts.id,
        fromPhone: OPERATOR_PHONE,
        handler: "whatsapp.webhook",
        outcome: opts.outcome ?? "received",
        attempts: opts.attempts ?? 0,
        createdAt: opts.updatedAt ?? TEN_MINUTES_AGO(),
        updatedAt: opts.updatedAt ?? TEN_MINUTES_AGO(),
        ...(opts.withPayload === false
          ? {}
          : {
              payload: {
                id: opts.id,
                from: OPERATOR_PHONE,
                type: "text",
                body: `accept:${opts.inquiryId}`,
                buttonPayloads: [],
              },
            }),
      },
    });
  }

  it("replays a stranded stale receipt from its stored payload - no Meta redelivery needed", async () => {
    const inquiry = await seedPendingInquiry();
    await seedStrandedReceipt({ id: "wamid.stranded.1", inquiryId: inquiry.id });
    const { options } = makeHarness();

    const result = await recoverStaleWhatsAppReceipts(options);

    expect(result.reprocessed).toBe(1);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
    const receipt = await prisma.whatsAppInboundReceipt.findUniqueOrThrow({
      where: { providerMessageId: "wamid.stranded.1" },
    });
    expect(receipt.outcome).toBe("processed");
    expect(receipt.attempts).toBe(1);
    expect(receipt.processedAt).not.toBeNull();
  });

  it("marks a receipt without a replayable payload as failed and logs it visibly", async () => {
    const inquiry = await seedPendingInquiry();
    await seedStrandedReceipt({ id: "wamid.nopayload.1", inquiryId: inquiry.id, withPayload: false });
    const { errors, options } = makeHarness();

    const result = await recoverStaleWhatsAppReceipts(options);

    expect(result.failed).toBe(1);
    expect(
      (await prisma.whatsAppInboundReceipt.findUniqueOrThrow({ where: { providerMessageId: "wamid.nopayload.1" } })).outcome,
    ).toBe("failed");
    expect(errors.some((e) => e.event === "whatsapp.webhook.receipt_without_replayable_payload")).toBe(true);
  });

  it("returns a failing replay to received below the attempt cap, then fails visibly at the cap", async () => {
    const inquiry = await seedPendingInquiry();
    await seedStrandedReceipt({ id: "wamid.failing.1", inquiryId: inquiry.id, attempts: 3 });
    const { errors, options } = makeHarness();
    const failingOptions: WhatsAppWebhookHandlerOptions = {
      ...options,
      inquiryActions: {
        processOperatorInquiryAction: async () => {
          throw new Error("simulated persistent failure");
        },
      },
    };

    await recoverStaleWhatsAppReceipts(failingOptions);
    let receipt = await prisma.whatsAppInboundReceipt.findUniqueOrThrow({
      where: { providerMessageId: "wamid.failing.1" },
    });
    expect(receipt.outcome).toBe("received");
    expect(receipt.attempts).toBe(4);
    expect(errors.some((e) => e.event === "whatsapp.webhook.receipt_recovery_exhausted")).toBe(false);

    await prisma.whatsAppInboundReceipt.update({
      where: { providerMessageId: "wamid.failing.1" },
      data: { updatedAt: TEN_MINUTES_AGO() },
    });
    await recoverStaleWhatsAppReceipts(failingOptions);
    receipt = await prisma.whatsAppInboundReceipt.findUniqueOrThrow({
      where: { providerMessageId: "wamid.failing.1" },
    });
    expect(receipt.outcome).toBe("failed");
    expect(receipt.attempts).toBe(5);
    expect(errors.some((e) => e.event === "whatsapp.webhook.receipt_recovery_exhausted")).toBe(true);
  });

  it("requeues a terminal failure after the longer backoff instead of losing it silently", async () => {
    const inquiry = await seedPendingInquiry();
    await seedStrandedReceipt({
      id: "wamid.failed.1",
      inquiryId: inquiry.id,
      outcome: "failed",
      attempts: 2,
      updatedAt: new Date(Date.now() - 31 * 60 * 1000),
    });
    const { options } = makeHarness();

    // First sweep: requeued, not yet replayed (its updatedAt just refreshed).
    await recoverStaleWhatsAppReceipts(options);
    expect(
      (await prisma.whatsAppInboundReceipt.findUniqueOrThrow({ where: { providerMessageId: "wamid.failed.1" } })).outcome,
    ).toBe("received");
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");

    // Once it is stale again, the next sweep replays it.
    await prisma.whatsAppInboundReceipt.update({
      where: { providerMessageId: "wamid.failed.1" },
      data: { updatedAt: TEN_MINUTES_AGO() },
    });
    await recoverStaleWhatsAppReceipts(options);
    expect(
      (await prisma.whatsAppInboundReceipt.findUniqueOrThrow({ where: { providerMessageId: "wamid.failed.1" } })).outcome,
    ).toBe("processed");
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_ACCEPTED");
  });

  it("leaves a fresh in-flight receipt alone", async () => {
    const inquiry = await seedPendingInquiry();
    await seedStrandedReceipt({ id: "wamid.fresh.1", inquiryId: inquiry.id, updatedAt: new Date() });
    const { options } = makeHarness();

    const result = await recoverStaleWhatsAppReceipts(options);

    expect(result.reprocessed).toBe(0);
    const receipt = await prisma.whatsAppInboundReceipt.findUniqueOrThrow({
      where: { providerMessageId: "wamid.fresh.1" },
    });
    expect(receipt.outcome).toBe("received");
    expect(receipt.attempts).toBe(0);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
  });
});

describe("phonesExactlyMatch (canonical, country-grounded)", () => {
  it("matches stored E.164 and 00-prefixed forms against the Meta international form", () => {
    expect(phonesExactlyMatch("+61412345678", "61412345678")).toBe(true);
    expect(phonesExactlyMatch("0061412345678", "61412345678")).toBe(true);
  });
  it("matches a stored AU local number (trunk 0) against the Meta form", () => {
    expect(phonesExactlyMatch("0412345678", "61412345678")).toBe(true);
  });
  it("matches a stored formatted international number", () => {
    expect(phonesExactlyMatch("+62 812 3456 7001", "6281234567001")).toBe(true);
  });
  it("rejects stored bare international digits - ambiguous without a marker, never dial-detected", () => {
    // Legacy normalizePhone storage ("62812...") denies until rewritten to
    // marked E.164; the write paths now store the marked form.
    expect(phonesExactlyMatch("6281234567001", "6281234567001")).toBe(false);
    expect(phonesExactlyMatch("61412345678", "61412345678")).toBe(false);
  });
  it("rejects a stored trunk-less national that would dial-detect as another country (reviewer regression)", () => {
    // "412345678" stored bare must NOT become +41 2345678 (Swiss) and hand a
    // foreign subscriber operator authority.
    expect(phonesExactlyMatch("412345678", "412345678")).toBe(false);
  });
  it("rejects the same national number under a different country (the suffix-matching hole)", () => {
    expect(phonesExactlyMatch("+61412345678", "62412345678")).toBe(false);
    expect(phonesExactlyMatch("0412345678", "1412345678")).toBe(false);
  });
  it("fails closed for a non-AU local number stored without a country marker", () => {
    // "0812..." read under the AU default cannot equal +62812... - a data
    // problem (store E.164), never a reason to guess the country.
    expect(phonesExactlyMatch("08123456789", "628123456789")).toBe(false);
  });
  it("rejects identical garbage (no raw-digit shortcut - both sides canonicalize)", () => {
    expect(phonesExactlyMatch("123", "123")).toBe(false);
  });
  it("rejects unresolvable values", () => {
    expect(phonesExactlyMatch("123", "61412345678")).toBe(false);
    expect(phonesExactlyMatch(undefined, "61412345678")).toBe(false);
    expect(phonesExactlyMatch("61412345678", undefined)).toBe(false);
  });
});
