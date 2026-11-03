/**
 * The traveller side of the WhatsApp concierge: an inbound text from a phone
 * with no operator context is a guest talking to the business number. It is
 * answered by the in-repo Kai conversation service - the same brain as the web
 * chat - with the session threaded by the sender's phone, so the conversation
 * survives across messages and the phone slot is prefilled from the verified
 * sender instead of being asked for.
 *
 * Two deliberate boundaries:
 * - Guest data stays in this database. Nothing here forwards to kai-core; when
 *   KAI_CORE_ENABLED=true the webhook route forwards the payload instead and
 *   this path stays out of the way (no double replies).
 * - Off by default: WHATSAPP_TRAVELLER_CONVERSATION_ENABLED must be "true".
 *   Merging this code changes no live behavior until that env is set.
 */
import { prisma } from "@/lib/db/prisma";
import { kaiConversationService } from "@/lib/services/kai/conversation-service";
import type { KaiConversationService } from "@/lib/services/kai/conversation-service";

export const TRAVELLER_CONVERSATION_FLAG = "WHATSAPP_TRAVELLER_CONVERSATION_ENABLED";

export function isTravellerConversationEnabled(env: Record<string, string | undefined> = process.env) {
  // kai-core, when configured, owns traveller conversation: the route forwards
  // the payload there. The in-repo path never runs alongside it (no double replies).
  if (env.KAI_CORE_ENABLED === "true") {
    return false;
  }
  return env[TRAVELLER_CONVERSATION_FLAG] === "true";
}

export type TravellerConversationDeps = {
  conversationService?: KaiConversationService;
};

export type TravellerConversationResult = {
  sessionId: string;
  reply: string;
};

export async function handleTravellerWhatsAppMessage(
  input: { from: string; body: string },
  deps: TravellerConversationDeps = {},
): Promise<TravellerConversationResult> {
  const phone = input.from.replace(/[^\d]/g, "");
  if (!phone) {
    throw new Error("Traveller WhatsApp message has no sender phone.");
  }

  const service = deps.conversationService ?? kaiConversationService;

  const existing = await prisma.kaiSession.findFirst({
    where: { channel: "WHATSAPP", travellerPhone: phone, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  const result = await service.handleUserMessage({
    channel: "whatsapp",
    sessionId: existing?.id,
    travellerPhone: phone,
    message: input.body,
  });

  return { sessionId: result.sessionId, reply: result.reply };
}
