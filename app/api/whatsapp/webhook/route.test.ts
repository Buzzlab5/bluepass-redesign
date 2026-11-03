/**
 * Route-level tests for the WhatsApp webhook: the HTTP status Meta sees is
 * what decides whether Meta redelivers, so these assert the ACTUAL route
 * responses - not just handler behavior. Runs under vitest.rails.config.ts
 * (local Postgres only) - never the shared database.
 */
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { POST } from "./route";

const APP_SECRET = "whatsapp-route-test-secret";
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
delete process.env.KAI_CORE_ENABLED;

const OPERATOR_PHONE = "6281234567001";

function signedRequest(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto
    .createHmac("sha256", APP_SECRET)
    .update(rawBody, "utf8")
    .digest("hex")}`;
  return new NextRequest("http://localhost/api/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
    body: rawBody,
  });
}

function payloadWithMessage(message: Record<string, unknown>) {
  return { entry: [{ changes: [{ value: { messages: [message] } }] }] };
}

function textMessage(body: string, id: string, from = OPERATOR_PHONE) {
  return { from, id, type: "text", text: { body } };
}

async function seedPendingInquiry() {
  const inquiry = await prisma.bookingInquiry.create({
    data: {
      sourceChannel: "WHATSAPP",
      selectedYachtName: "Calico Jack",
      dateWindow: "20 July 2026",
      guests: 2,
      status: "OPERATOR_PENDING",
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

describe("POST /api/whatsapp/webhook route responses", () => {
  it("answers 200 when the operator action processes", async () => {
    const inquiry = await seedPendingInquiry();
    const response = await POST(
      signedRequest(payloadWithMessage(textMessage(`accept:${inquiry.id}`, "wamid.route.ok.1"))),
    );
    expect(response.status).toBe(200);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe(
      "OPERATOR_ACCEPTED",
    );
  });

  it("answers 500 while the first delivery's lease is still in flight, so Meta keeps redelivering", async () => {
    const inquiry = await seedPendingInquiry();
    await prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: "wamid.route.inflight.1",
        fromPhone: OPERATOR_PHONE,
        handler: "whatsapp.webhook",
        outcome: "received",
      },
    });

    const response = await POST(
      signedRequest(payloadWithMessage(textMessage(`accept:${inquiry.id}`, "wamid.route.inflight.1"))),
    );

    expect(response.status).toBe(500);
    // The in-flight delivery's receipt is untouched: it, not the duplicate,
    // owns settling the outcome.
    expect(
      (await prisma.whatsAppInboundReceipt.findUniqueOrThrow({ where: { providerMessageId: "wamid.route.inflight.1" } }))
        .outcome,
    ).toBe("received");
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe(
      "OPERATOR_PENDING",
    );
  });

  it("answers 200 for a duplicate of an already-processed delivery", async () => {
    const inquiry = await seedPendingInquiry();
    await prisma.whatsAppInboundReceipt.create({
      data: {
        providerMessageId: "wamid.route.done.1",
        fromPhone: OPERATOR_PHONE,
        handler: "whatsapp.webhook",
        outcome: "processed",
      },
    });

    const response = await POST(
      signedRequest(payloadWithMessage(textMessage(`accept:${inquiry.id}`, "wamid.route.done.1"))),
    );

    expect(response.status).toBe(200);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe(
      "OPERATOR_PENDING",
    );
  });

  it("answers 200 for a foreign button payload and records a terminal failed receipt", async () => {
    const inquiry = await seedPendingInquiry();
    const foreignButton = {
      from: OPERATOR_PHONE,
      id: "wamid.route.foreign.1",
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "unrelated-app-payload", title: "View" },
      },
    };

    // A 500 here would loop Meta redeliveries of a payload that can never
    // parse. 200 + a terminal failed receipt ends the loop visibly.
    const response = await POST(signedRequest(payloadWithMessage(foreignButton)));
    expect(response.status).toBe(200);

    const receipt = await prisma.whatsAppInboundReceipt.findUniqueOrThrow({
      where: { providerMessageId: "wamid.route.foreign.1" },
    });
    expect(receipt.outcome).toBe("failed");
    expect(receipt.attempts).toBe(5);
    expect((await prisma.bookingInquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe("OPERATOR_PENDING");
  });

  it("answers 401 for an invalid signature", async () => {
    const request = new NextRequest("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
      body: "{}",
    });
    expect((await POST(request)).status).toBe(401);
  });
});
