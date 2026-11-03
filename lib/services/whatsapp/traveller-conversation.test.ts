/**
 * End-to-end against the real in-repo Kai conversation service and store:
 * a traveller WhatsApp message creates a threaded WHATSAPP session in the same
 * database, and the next message continues it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { handleTravellerWhatsAppMessage, isTravellerConversationEnabled } from "./traveller-conversation";

const PHONE = "6281000007777";

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE "KaiMessage", "KaiSession" CASCADE`);
});

describe("handleTravellerWhatsAppMessage (real Kai service)", () => {
  it("creates a WHATSAPP session keyed by phone and threads the next message into it", async () => {
    const first = await handleTravellerWhatsAppMessage({
      from: PHONE,
      body: "Hi, I want to book a boat trip in Komodo for 2 people",
    });
    expect(first.reply.trim().length).toBeGreaterThan(0);

    const session = await prisma.kaiSession.findFirstOrThrow({
      where: { channel: "WHATSAPP", travellerPhone: PHONE },
    });
    expect(session.id).toBe(first.sessionId);

    const second = await handleTravellerWhatsAppMessage({ from: PHONE, body: "Around 20 July 2026" });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.reply.trim().length).toBeGreaterThan(0);

    const messages = await prisma.kaiMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    expect(messages.filter((m) => m.role === "USER").map((m) => m.content)).toEqual([
      "Hi, I want to book a boat trip in Komodo for 2 people",
      "Around 20 July 2026",
    ]);
    expect(messages.some((m) => m.role === "ASSISTANT")).toBe(true);
  });
});

describe("isTravellerConversationEnabled", () => {
  it("is off by default, on with the flag, and always off when kai-core owns conversation", () => {
    expect(isTravellerConversationEnabled({})).toBe(false);
    expect(isTravellerConversationEnabled({ WHATSAPP_TRAVELLER_CONVERSATION_ENABLED: "true" })).toBe(true);
    expect(
      isTravellerConversationEnabled({
        WHATSAPP_TRAVELLER_CONVERSATION_ENABLED: "true",
        KAI_CORE_ENABLED: "true",
      }),
    ).toBe(false);
  });
});
