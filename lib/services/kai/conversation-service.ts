import { randomUUID } from "crypto";
import { yachtBySlug } from "@/lib/data/yachts";
import { planKaiConversation } from "@/lib/services/kai/conversation-planner";
import { sanitizeObjectForResponse } from "@/lib/services/kai/json-safety";
import { generateKaiReply } from "@/lib/services/kai/llm-provider";
import { prismaKaiConversationStore } from "@/lib/services/kai/prisma-conversation-store";
import { extractKaiTravelIntent } from "@/lib/services/kai/slot-extractor";
import { searchYachtsForIntent } from "@/lib/services/kai/yacht-catalog-search";
import type {
  KaiChannel,
  KaiConversationInput,
  KaiConversationMessage,
  KaiConversationResult,
  KaiMissingSlot,
  KaiSessionContext,
  KaiSessionStatus,
  KaiSuggestedReply,
  KaiTravelIntent,
  YachtMatch,
} from "@/lib/services/kai/types";

export const DEFAULT_KAI_REPLY =
  "Thanks - I can help you find the right marine trip. Where are you hoping to go, and what kind of experience are you looking for?";

type PersistSessionInput = {
  id: string;
  channel: KaiChannel;
  externalUserId?: string;
  travellerId?: string;
  travellerPhone?: string;
  referralAttribution?: KaiConversationInput["referralAttribution"];
  status: KaiSessionStatus;
  context?: KaiSessionContext;
};

type PersistTurnInput = {
  session: PersistSessionInput;
  messages: KaiConversationMessage[];
};

export type KaiConversationStore = {
  upsertSession(session: PersistSessionInput): Promise<void>;
  addMessage(message: KaiConversationMessage): Promise<void>;
  persistTurn?(input: PersistTurnInput): Promise<void>;
  getSessionContext?(input: {
    sessionId: string;
    channel: KaiChannel;
  }): Promise<KaiSessionContext | undefined>;
  listMessages?(input: {
    sessionId: string;
    channel: KaiChannel;
    limit?: number;
  }): Promise<KaiConversationMessage[]>;
};

const noopStore: KaiConversationStore = {
  async upsertSession() {},
  async addMessage() {},
};

export type KaiConversationService = {
  handleUserMessage(
    input: KaiConversationInput,
  ): Promise<KaiConversationResult>;
};

export function createKaiConversationService(
  store: KaiConversationStore = noopStore,
): KaiConversationService {
  return {
    async handleUserMessage(input) {
      const sessionId = input.sessionId ?? generateKaiSessionId();
      logKaiStage("kai.web_chat.request_received", {
        sessionId,
        channel: input.channel,
      });
      logKaiStage("kai.session.resolve_started", {
        sessionId,
        channel: input.channel,
        hasProvidedSessionId: Boolean(input.sessionId),
      });
      const previousContext = await loadSessionContextSafely(store, {
        sessionId,
        channel: input.channel,
        hasProvidedSessionId: Boolean(input.sessionId),
      });
      const previousMessages = await loadHistorySafely(store, {
        sessionId,
        channel: input.channel,
        hasProvidedSessionId: Boolean(input.sessionId),
      });
      const recentClientMessages = normalizeRecentClientMessages(
        input.recentMessages,
        {
          sessionId,
          channel: input.channel,
          latestUserMessage: input.message,
        },
      );
      const conversationMemory = mergeConversationMemory(
        previousMessages,
        recentClientMessages,
      );
      const reconstructedIntent = reconstructIntentFromHistory(
        conversationMemory,
        previousContext?.intent,
      );
      const prefilledIntent = mergeTravellerProfileIntoIntent(
        reconstructedIntent,
        input.travellerProfile,
      );
      const inferredLastAskedSlot =
        previousContext?.lastAskedSlot ??
        inferLastAskedSlotFromHistory(conversationMemory);
      const contextKeys = previousContext ? Object.keys(previousContext) : [];
      logKaiStage("kai.session.loaded_or_created", {
        sessionId,
        channel: input.channel,
        hasExistingContext: Boolean(previousContext),
        contextKeys,
      });
      logKaiStage("kai.intent.extraction_started", {
        sessionId,
        channel: input.channel,
      });
      let intent = extractKaiTravelIntent(
        input.message,
        prefilledIntent,
        {
          lastAskedSlot: inferredLastAskedSlot,
        },
      );
      intent = sanitizeRecoveredIntent(intent);
      intent = defaultTripTypeToLiveaboardWhenReady(intent);
      const planner = planKaiConversation({
        intent,
        previousIntent: previousContext?.intent,
        lastAskedSlot: previousContext?.lastAskedSlot,
        latestUserMessage: input.message,
        channel: input.channel,
      });
      logKaiStage("kai.intent.extraction_succeeded", {
        sessionId,
        channel: input.channel,
        intentKeys: Object.keys(intent),
        missingSlots: planner.missingSlots,
      });
      logKaiStage("kai.intent.extracted", {
        sessionId,
        channel: input.channel,
        intentKeys: Object.keys(intent),
        missingSlots: planner.missingSlots,
      });
      const matches =
        planner.conversationStage === "ready_to_match"
          ? narrowMatchesToSelectedYacht(
              searchYachtsSafely(intent, sessionId, input.channel),
              intent.selectedYachtSlug,
            )
          : [];
      const deterministicReply = buildDeterministicReply(
        intent,
        planner,
        input.message,
        matches,
      );
      const suggestedReplies = buildSuggestedReplies(intent, planner, matches);
      const context = buildSessionContext(intent, planner);
      const userMessage = buildMessage({
        sessionId,
        channel: input.channel,
        role: "user",
        content: input.message,
        metadata: {
          ...(input.bookingContext
            ? { bookingContext: input.bookingContext }
            : {}),
          ...(input.travellerProfile
            ? { travellerProfile: input.travellerProfile }
            : {}),
          ...(input.referralAttribution
            ? { referralAttribution: input.referralAttribution }
            : {}),
          intent,
          matches,
          lastAskedSlot: inferredLastAskedSlot,
        },
      });
      logKaiStage("kai.llm.call_started", {
        sessionId,
        channel: input.channel,
        previousMessageCount: previousMessages.length,
        recentClientMessageCount: recentClientMessages.length,
      });
      const reply = await generateReplySafely({
        messages: [...conversationMemory, userMessage],
        intent,
        missingSlots: planner.missingSlots,
        channel: input.channel,
        deterministicReply,
        planner,
        matches,
      });
      const safeReply = enforcePlannerReply(
        reply,
        deterministicReply,
        planner,
        input.message,
        matches,
      );
      logKaiStage("kai.assistant_reply.generated", {
        sessionId,
        channel: input.channel,
        replyLength: safeReply.length,
      });
      const assistantMessage = buildMessage({
        sessionId,
        channel: input.channel,
        role: "assistant",
        content: safeReply,
        metadata: { intent, matches, suggestedReplies, lastAskedSlot: context.lastAskedSlot },
      });

      const sessionToPersist = {
        id: sessionId,
        channel: input.channel,
        externalUserId: buildExternalUserId(
          input.externalUserId,
          input.travellerProfile,
        ),
        travellerId: input.travellerProfile?.travellerId,
        travellerPhone: input.travellerProfile?.phone ?? input.travellerPhone,
        referralAttribution: input.referralAttribution,
        status: "open",
        context,
      } satisfies PersistSessionInput;

      try {
        if (store.persistTurn) {
          await store.persistTurn({
            session: sessionToPersist,
            messages: [userMessage, assistantMessage],
          });
        } else {
          await store.upsertSession(sessionToPersist);
          await store.addMessage(userMessage);
          await store.addMessage(assistantMessage);
        }
        logKaiStage("kai.session.context.persisted", {
          sessionId,
          channel: input.channel,
        });
        logKaiStage("kai.messages.persisted", {
          sessionId,
          channel: input.channel,
          messageCount: 2,
        });
      } catch (error) {
        logPersistenceFailure(
          "kai.turn.persisted",
          sessionId,
          input.channel,
          "persistTurn",
          error,
        );
      }

      logKaiStage("kai.web_chat.response_ready", {
        sessionId,
        channel: input.channel,
        replyLength: assistantMessage.content.length,
      });

      return {
        sessionId,
        reply: assistantMessage.content,
        intent: sanitizeObjectForResponse(intent),
        matches: sanitizeObjectForResponse(matches),
        suggestedReplies: sanitizeObjectForResponse(suggestedReplies),
        planner: shouldExposePlanner()
          ? sanitizeObjectForResponse(planner)
          : undefined,
        messages: [userMessage, assistantMessage],
      };
    },
  };
}

function mergeTravellerProfileIntoIntent(
  intent: KaiTravelIntent,
  travellerProfile?: KaiConversationInput["travellerProfile"],
): KaiTravelIntent {
  if (!travellerProfile) {
    return intent;
  }

  return {
    ...intent,
    travellerName: intent.travellerName ?? travellerProfile.name,
    travellerEmail: intent.travellerEmail ?? travellerProfile.email,
    travellerPhone: intent.travellerPhone ?? travellerProfile.phone,
  };
}

function sanitizeRecoveredIntent(intent: KaiTravelIntent): KaiTravelIntent {
  if (!isConfirmationOnlyName(intent.travellerName)) {
    return intent;
  }

  return {
    ...intent,
    travellerName: undefined,
    missingSlots: uniqueKaiMissingSlots([
      ...(intent.missingSlots ?? []),
      "travellerName",
    ]),
  };
}

function isConfirmationOnlyName(value?: string) {
  return Boolean(
    value &&
      /^(?:yes|yeah|yep|sure|ok|okay|please|confirm|confirmed|go ahead)$/i.test(
        value.trim(),
      ),
  );
}

function uniqueKaiMissingSlots(values: string[]) {
  return Array.from(new Set(values)) as KaiMissingSlot[];
}

function buildExternalUserId(
  explicitExternalUserId?: string,
  travellerProfile?: KaiConversationInput["travellerProfile"],
) {
  if (explicitExternalUserId) {
    return explicitExternalUserId;
  }

  if (!travellerProfile) {
    return undefined;
  }

  if (travellerProfile.travellerId) {
    return `traveller:${travellerProfile.travellerId}`;
  }

  return `account:${travellerProfile.accountId ?? travellerProfile.id}`;
}

export const kaiConversationService = createKaiConversationService(
  prismaKaiConversationStore,
);

export function generateKaiSessionId() {
  return `kai_${randomUUID()}`;
}

export function buildDeterministicReply(
  intent: KaiTravelIntent,
  planner = planKaiConversation({
    intent,
    latestUserMessage: "",
    channel: "web",
  }),
  latestUserMessage = "",
  matches: YachtMatch[] = [],
) {
  if (intent.unsupportedDestination) {
    return `BluePass is currently focused on Komodo and Raja Ampat liveaboards. I can't match ${intent.unsupportedDestination} yet, but I can help compare Komodo and Raja Ampat if either works for you.`;
  }

  const travelAdviceReply = buildTravelAdviceReply(intent, latestUserMessage);

  if (travelAdviceReply) {
    return travelAdviceReply;
  }

  const destinationOverviewReply = buildDestinationOverviewReply(
    intent,
    latestUserMessage,
  );

  if (destinationOverviewReply) {
    return destinationOverviewReply;
  }

  if (planner.missingSlots.includes("destination")) {
    const knownParts = [
      intent.tripType ? `${intent.tripType}` : undefined,
      intent.guests ? `for ${intent.guests}` : undefined,
    ].filter(Boolean);
    const prefix =
      knownParts.length > 0 ? `Got it: ${knownParts.join(" ")}. ` : "";

    return `${prefix}Do you want me to focus on Komodo or Raja Ampat?`;
  }

  if (planner.missingSlots.includes("tripType")) {
    const guestText = intent.guests ? ` for ${intent.guests}` : "";

    return `${intent.destination}${guestText} works. Should I look for a dive-heavy liveaboard, a more relaxed cruising trip, or a bit of both?`;
  }

  if (planner.missingSlots.includes("guests")) {
    return `Nice, ${intent.destination} ${intent.tripType}. How many people/guests should I plan for?`;
  }

  if (planner.missingSlots.includes("dateWindow")) {
    return `Got it: ${intent.destination} ${intent.tripType} for ${intent.guests} guests. When are you hoping to travel - exact dates or a rough month is fine.`;
  }

  if (planner.missingSlots.includes("budget")) {
    const certificationText = intent.certificationLevel
      ? `, ${intent.certificationLevel}`
      : "";

    return `Perfect, ${intent.destination} ${intent.tripType} for ${intent.guests} guests${certificationText}. What budget range should I keep in mind?`;
  }

  if (
    planner.missingSlots.includes("travellerName") ||
    planner.missingSlots.includes("travellerEmail") ||
    planner.missingSlots.includes("travellerPhone")
  ) {
    const selectedYacht = intent.selectedYachtSlug
      ? yachtBySlug[intent.selectedYachtSlug]
      : undefined;
    const prefix = selectedYacht
      ? `Nice choice. I can prepare the inquiry for ${selectedYacht.name}.`
      : "Great, I have the trip details.";
    const missingContactFields = buildMissingContactFieldText(
      planner.missingSlots,
    );

    return `${prefix} ${missingContactFields}`;
  }

  if (intent.selectedYachtSlug) {
    const selectedYacht = yachtBySlug[intent.selectedYachtSlug];
    const yachtName = selectedYacht?.name ?? "that yacht";

    return `Great, I have the essentials for a ${yachtName} inquiry: ${intent.destination}, ${intent.guests} guests, ${intent.dateWindow}, and ${intent.budget}. Tap Send inquiry on the ${yachtName} card and I'll send it to the operator.`;
  }

  if (matches.length > 0) {
    return buildMatchedTripsReply(intent, matches);
  }

  return `Perfect. I can match a few ${intent.destination} options for ${intent.guests} guests. I’ll keep it to preview catalog matches for now, then you can send an inquiry when one feels right.`;
}

export function buildSuggestedReplies(
  intent: KaiTravelIntent,
  planner = planKaiConversation({
    intent,
    latestUserMessage: "",
    channel: "web",
  }),
  matches: YachtMatch[] = [],
): KaiSuggestedReply[] {
  if (intent.unsupportedDestination) {
    return [
      {
        label: "Tell me about Komodo",
        message: "Tell me about Komodo liveaboards",
      },
      {
        label: "Tell me about Raja Ampat",
        message: "Tell me about Raja Ampat liveaboards",
      },
    ];
  }

  if (planner.conversationStage === "ready_to_match" && matches.length > 0) {
    return matches.slice(0, 3).map((match) => ({
      label: match.name,
      message: `I'm interested in ${match.name}`,
    }));
  }

  const nextSlot = planner.nextSlotToAsk;

  if (!nextSlot || nextSlot === "destination") {
    return [
      {
        label: "Tell me about Komodo",
        message: "Tell me about Komodo liveaboards",
      },
      {
        label: "Tell me about Raja Ampat",
        message: "Tell me about Raja Ampat liveaboards",
      },
      {
        label: "I want to dive",
        message: "I want a dive-focused liveaboard",
      },
      {
        label: "Just exploring",
        message: "I'm just exploring liveaboard options",
      },
    ];
  }

  if (nextSlot === "tripType") {
    return [
      { label: "Dive-focused", message: "Dive-focused liveaboard" },
      { label: "Cruising-focused", message: "Cruising-focused liveaboard" },
      { label: "A mix of both", message: "A mix of diving and cruising" },
    ];
  }

  if (nextSlot === "guests") {
    return [
      { label: "Couple / 2 guests", message: "2 guests" },
      { label: "Small group of 4", message: "4 guests" },
      { label: "Group of 6", message: "6 guests" },
    ];
  }

  if (nextSlot === "dateWindow") {
    const destination = intent.destination ?? "there";
    return [
      { label: "Best season?", message: `What is the best time to go to ${destination}?` },
      { label: "December 2026", message: "December 2026" },
      { label: "January 2027", message: "January 2027" },
    ];
  }

  if (nextSlot === "budget") {
    return [
      { label: "Around $4,000", message: "Around $4,000" },
      { label: "Under $8,000", message: "Under $8,000" },
      { label: "Luxury fit", message: "Luxury budget" },
    ];
  }

  if (nextSlot === "travellerName") {
    return [];
  }

  if (nextSlot === "travellerEmail") {
    return [];
  }

  if (nextSlot === "travellerPhone") {
    return [];
  }

  return [];
}

export function buildSessionContext(
  intent: KaiTravelIntent,
  planner = planKaiConversation({
    intent,
    latestUserMessage: "",
    channel: "web",
  }),
): KaiSessionContext {
  return {
    intent,
    missingSlots: planner.missingSlots,
    lastAskedSlot: planner.nextSlotToAsk as KaiMissingSlot | undefined,
  };
}

async function generateReplySafely(
  input: Parameters<typeof generateKaiReply>[0],
) {
  try {
    const reply = await generateKaiReply(input);

    return normalizeAssistantReply(reply) ?? input.deterministicReply;
  } catch (error) {
    console.warn("Kai reply generation failed; using deterministic fallback.", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return input.deterministicReply;
  }
}

function normalizeAssistantReply(reply: unknown) {
  if (typeof reply !== "string") {
    return undefined;
  }

  const normalized = reply.trim();

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRecentClientMessages(
  messages: KaiConversationInput["recentMessages"],
  input: { sessionId: string; channel: KaiChannel; latestUserMessage: string },
) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .slice(-12)
    .filter((message) => {
      if (!message || typeof message.content !== "string") {
        return false;
      }

      if (
        message.role !== "user" &&
        message.role !== "assistant" &&
        message.role !== "system"
      ) {
        return false;
      }

      return message.content.trim().length > 0;
    })
    .filter((message, index, safeMessages) => {
      const isLastMessage = index === safeMessages.length - 1;

      return !(
        isLastMessage &&
        message.role === "user" &&
        message.content.trim() === input.latestUserMessage.trim()
      );
    })
    .map((message) => ({
      sessionId: input.sessionId,
      channel: input.channel,
      role: message.role,
      content: message.content.trim(),
    }));
}

function mergeConversationMemory(
  storedMessages: KaiConversationMessage[],
  recentClientMessages: KaiConversationMessage[],
) {
  if (recentClientMessages.length === 0) {
    return storedMessages;
  }

  if (storedMessages.length === 0) {
    return recentClientMessages;
  }

  const merged = [...storedMessages, ...recentClientMessages];
  const seen = new Set<string>();

  return merged
    .filter((message) => {
      const key = `${message.role}:${message.content}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(-12);
}

function reconstructIntentFromHistory(
  messages: KaiConversationMessage[],
  initialIntent: KaiTravelIntent = {},
) {
  let intent = initialIntent;
  let lastAskedSlot: KaiMissingSlot | undefined;

  for (const message of messages) {
    if (message.role === "assistant") {
      lastAskedSlot =
        inferLastAskedSlotFromText(message.content) ?? lastAskedSlot;
    }

    if (message.role === "user") {
      intent = extractKaiTravelIntent(message.content, intent, {
        lastAskedSlot,
      });
    }
  }

  return intent;
}

function inferLastAskedSlotFromHistory(messages: KaiConversationMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role === "assistant") {
      const inferred = inferLastAskedSlotFromText(message.content);

      if (inferred) {
        return inferred;
      }
    }
  }

  return undefined;
}

function inferLastAskedSlotFromText(text: string): KaiMissingSlot | undefined {
  const normalized = text.toLowerCase();

  if (/how many|guests?|people|travelers|travellers/.test(normalized)) {
    return "guests";
  }

  if (/when|date|month|travel/.test(normalized)) {
    return "dateWindow";
  }

  if (/certification|certified|open water|advanced|divers/.test(normalized)) {
    return "certificationLevel";
  }

  if (/name|email|e-mail|phone|whatsapp|contact/.test(normalized)) {
    if (/email|e-mail/.test(normalized)) {
      return "travellerEmail";
    }

    if (/phone|whatsapp/.test(normalized)) {
      return "travellerPhone";
    }

    return "travellerName";
  }

  if (
    /what kind|trip type|experience|diving|sailing|liveaboard|snorkel/.test(
      normalized,
    )
  ) {
    return "tripType";
  }

  if (
    /where|destination|area|komodo|raja ampat|bali|indonesia/.test(normalized)
  ) {
    return "destination";
  }

  return undefined;
}

function enforcePlannerReply(
  reply: string,
  deterministicReply: string,
  planner: ReturnType<typeof planKaiConversation>,
  latestUserMessage = "",
  matches: YachtMatch[] = [],
) {
  if (planner.conversationStage === "ready_to_match" && matches.length > 0) {
    if (reply !== deterministicReply) {
      console.warn("kai.reply.overrode_ready_to_match_with_cards", {
        knownSlots: planner.knownSlots,
        missingSlots: planner.missingSlots,
        nextSlotToAsk: planner.nextSlotToAsk,
        matchCount: matches.length,
      });
    }

    return deterministicReply;
  }

  if (
    isTravelTimingQuestion(latestUserMessage) &&
    !replyAnswersTravelTiming(reply)
  ) {
    console.warn("kai.reply.overrode_missing_travel_advice_answer", {
      knownSlots: planner.knownSlots,
      missingSlots: planner.missingSlots,
      nextSlotToAsk: planner.nextSlotToAsk,
    });

    return deterministicReply;
  }

  if (replyClaimsInquiryWasCreatedOrSent(reply)) {
    console.warn("kai.reply.overrode_unbacked_inquiry_claim", {
      knownSlots: planner.knownSlots,
      missingSlots: planner.missingSlots,
      nextSlotToAsk: planner.nextSlotToAsk,
    });

    return deterministicReply;
  }

  if (
    planner.conversationStage === "ready_to_match" &&
    matches.length === 1 &&
    deterministicReply.includes("Tap Send inquiry") &&
    !replyKeepsSelectedYachtAction(reply)
  ) {
    console.warn("kai.reply.overrode_selected_yacht_relisting", {
      knownSlots: planner.knownSlots,
      missingSlots: planner.missingSlots,
      nextSlotToAsk: planner.nextSlotToAsk,
      matchCount: matches.length,
    });

    return deterministicReply;
  }

  const repeatedKnownSlot = planner.knownSlots.some((slot) =>
    replyAppearsToAskSlot(reply, slot),
  );

  if (!repeatedKnownSlot) {
    return reply;
  }

  console.warn("kai.reply.overrode_repeated_known_slot_question", {
    knownSlots: planner.knownSlots,
    missingSlots: planner.missingSlots,
    nextSlotToAsk: planner.nextSlotToAsk,
  });

  return deterministicReply;
}

function defaultTripTypeToLiveaboardWhenReady(intent: KaiTravelIntent) {
  if (
    intent.tripType ||
    !intent.destination ||
    !intent.guests ||
    !intent.dateWindow ||
    !intent.budget ||
    !intent.travellerName ||
    !intent.travellerEmail ||
    !intent.travellerPhone
  ) {
    return intent;
  }

  return {
    ...intent,
    tripType: "liveaboard",
    missingSlots: intent.missingSlots?.filter((slot) => slot !== "tripType"),
  };
}

function replyClaimsInquiryWasCreatedOrSent(reply: string) {
  const normalized = reply.toLowerCase();

  return (
    /\b(?:i'?ve|i have|we'?ve|we have)\s+(?:prepared|created|made|sent)\s+(?:an?\s+)?inquiry\b/.test(
      normalized,
    ) ||
    /\b(?:i'?ll|i will|we'?ll|we will)\s+send\s+(?:it|this|the inquiry|an inquiry)\b/.test(
      normalized,
    ) ||
    /\b(?:inquiry|request)\s+(?:has been|was)\s+(?:prepared|created|sent)\b/.test(
      normalized,
    ) ||
    /\b(?:operator|crew)\s+(?:will receive|has received|received)\s+(?:it|this|the inquiry|an inquiry)\b/.test(
      normalized,
    )
  );
}

function replyKeepsSelectedYachtAction(reply: string) {
  const normalized = reply.toLowerCase();

  if (
    /\b(shortlist|shortlisted|these include|catalog suggestions)\b/.test(
      normalized,
    )
  ) {
    return false;
  }

  return /\b(send inquiry|send the inquiry|tap|ready|everything needed|proceed)\b/.test(
    normalized,
  );
}

function buildMissingContactFieldText(missingSlots: KaiMissingSlot[]) {
  const fields = [
    missingSlots.includes("travellerName") ? "name" : undefined,
    missingSlots.includes("travellerEmail") ? "email" : undefined,
    missingSlots.includes("travellerPhone") ? "WhatsApp number" : undefined,
  ].filter(Boolean) as string[];

  if (fields.length === 0) {
    return "I have your contact details for the inquiry.";
  }

  return `What ${joinHumanList(fields)} should I put on the inquiry?`;
}

function joinHumanList(values: string[]) {
  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function buildTravelAdviceReply(
  intent: KaiTravelIntent,
  latestUserMessage: string,
) {
  if (!isTravelTimingQuestion(latestUserMessage) || !intent.destination) {
    return undefined;
  }

  const season = getDestinationSeasonAdvice(intent.destination);

  if (!season) {
    return undefined;
  }

  const tripTypeText = intent.tripType ? ` for ${intent.tripType}` : "";
  const guestText = intent.guests ? ` for ${intent.guests} guests` : "";
  const dateText = intent.dateWindow
    ? ` Your ${intent.dateWindow} timing can still work, but it may not be the peak window.`
    : "";
  const nextStep =
    intent.budget || intent.dateWindow
      ? "I can use that to narrow the best-fit options."
      : "If you have rough dates or budget, I can narrow the fit.";

  return `${season.destination} is usually best ${season.bestWindow}.${dateText} For ${season.destination}${tripTypeText}${guestText}, ${season.note} ${nextStep}`;
}

function buildDestinationOverviewReply(
  intent: KaiTravelIntent,
  latestUserMessage: string,
) {
  if (!isDestinationOverviewQuestion(latestUserMessage) || !intent.destination) {
    return undefined;
  }

  const overview = getDestinationOverview(intent.destination);

  if (!overview) {
    return undefined;
  }

  const tripTypeText = intent.tripType
    ? ` ${intent.tripType}`
    : " liveaboard";
  const nextQuestion =
    intent.tripType && !intent.guests
      ? "If you want, tell me roughly how many guests and I can narrow the style from there."
      : "If you want, I can help compare dive-heavy, cruising-focused, and mixed liveaboard styles.";

  return `${overview.destination}${tripTypeText}s are best for ${overview.bestFor}. ${overview.texture} ${overview.constraint} ${nextQuestion}`;
}

function isDestinationOverviewQuestion(message: string) {
  const normalized = message.toLowerCase();

  return (
    /\b(tell me about|what is|what's|explain|info about|learn about|describe)\b/.test(
      normalized,
    ) &&
    /\b(komodo|raja\s*ampat|liveaboards?|diving|cruising)\b/.test(normalized)
  );
}

function getDestinationOverview(destination: string) {
  if (destination === "Komodo") {
    return {
      destination: "Komodo",
      bestFor:
        "dramatic island scenery, manta sites, current-swept dives, and a compact liveaboard route from Labuan Bajo",
      texture:
        "It usually feels more rugged and volcanic: pink beaches, dragons on land, clear ridgelines, and dive days that can be gentle or spicy depending on site and season.",
      constraint:
        "BluePass treats catalog prices as signals only, so I will not call anything available until an operator confirms.",
    };
  }

  if (destination === "Raja Ampat") {
    return {
      destination: "Raja Ampat",
      bestFor:
        "remote reefs, soft coral, calmer expedition pacing, and longer liveaboard routes through very spread-out islands",
      texture:
        "It feels more remote and reef-forward than Komodo, with slower crossings, huge biodiversity, and a stronger reason to plan around season.",
      constraint:
        "BluePass treats catalog prices as signals only, so I will not call anything available until an operator confirms.",
    };
  }

  return undefined;
}

function searchYachtsSafely(
  intent: KaiTravelIntent,
  sessionId: string,
  channel: KaiChannel,
) {
  try {
    const matches = searchYachtsForIntent(intent);

    logKaiStage("kai.matches.loaded", {
      sessionId,
      channel,
      matchCount: matches.length,
    });

    return matches;
  } catch (error) {
    console.warn("kai.matches.failed", {
      sessionId: maskSessionId(sessionId),
      channel,
      errorName: error instanceof Error ? error.name : "UnknownError",
      message:
        error instanceof Error
          ? error.message
          : "Unable to load Kai yacht catalog matches",
    });

    return [];
  }
}

function narrowMatchesToSelectedYacht(
  matches: YachtMatch[],
  selectedYachtSlug?: string,
) {
  if (!selectedYachtSlug) {
    return matches;
  }

  const selected = matches.find((match) => match.slug === selectedYachtSlug);

  return selected ? [selected] : matches;
}

function buildMatchedTripsReply(
  intent: KaiTravelIntent,
  matches: YachtMatch[],
) {
  const intro =
    matches.length === 1
      ? `Based on the current BluePass preview fleet, for ${intent.destination} ${intent.tripType} with ${intent.guests} guests, this is the strongest match I’d start with:`
      : `Based on the current BluePass preview fleet, for ${intent.destination} ${intent.tripType} with ${intent.guests} guests, I’d start with these matches:`;
  const rows = matches
    .map((match, index) => {
      const price = match.charterOnly
        ? (match.charterPrice ?? "quote on request")
        : match.pricePerCabin;
      const priceLabel = match.charterOnly
        ? "private charter quote"
        : "cabin price signal";

      return `${index + 1}. ${match.name}, ${priceLabel}: ${price}; ${match.matchingReasons.slice(0, 3).join(", ")}.`;
    })
    .join("\n");

  return `${intro}\n${rows}\nThese are preview catalog signals, not live availability or final prices. If you'd like to proceed, I can prepare an inquiry - tap Send inquiry on the card that feels right and I’ll ask the operator.`;
}

function isTravelTimingQuestion(message: string) {
  const normalized = message.toLowerCase();

  return (
    /\b(best|better|ideal|recommended|good)\s+(time|month|season)\b/.test(
      normalized,
    ) ||
    /\bwhen\s+(?:is\s+)?(?:the\s+)?best\b/.test(normalized) ||
    /\bwhat\s+(?:is\s+)?(?:the\s+)?best\s+time\b/.test(normalized) ||
    /\bbest\s+time\s+to\s+go\b/.test(normalized)
  );
}

function replyAnswersTravelTiming(reply: string) {
  const normalized = reply.toLowerCase();

  return (
    /\b(october|november|december|january|february|march|april|may|june|july|august|september)\b/.test(
      normalized,
    ) ||
    /\b(dry season|wet season|shoulder season|monsoon|season)\b/.test(
      normalized,
    ) ||
    /\b(best|ideal|recommended)\s+(?:window|time|season|months?)\b/.test(
      normalized,
    )
  );
}

function getDestinationSeasonAdvice(destination: string) {
  const normalized = destination.toLowerCase();

  if (normalized.includes("raja ampat") || normalized.includes("misool")) {
    return {
      destination,
      bestWindow:
        "from October to April, with calmer seas and stronger liveaboard conditions",
      note: "June is shoulder/off-peak: possible, but conditions can be less predictable and fewer boats may run",
    };
  }

  if (normalized.includes("komodo") || normalized.includes("flores")) {
    return {
      destination,
      bestWindow:
        "from April to November, with June to September often excellent for dry-season liveaboard cruising",
      note: "June is generally a strong time for Komodo, though exact route choice still depends on sea conditions and operator schedules",
    };
  }

  if (
    normalized.includes("bali") ||
    normalized.includes("nusa penida") ||
    normalized.includes("nusa lembongan") ||
    normalized.includes("lombok") ||
    normalized.includes("gili")
  ) {
    return {
      destination,
      bestWindow: "from April to October during the drier months",
      note: "June usually fits well, especially for cleaner weather and easier sea days",
    };
  }

  if (normalized.includes("alor")) {
    return {
      destination,
      bestWindow:
        "from April to November, with the driest stretch usually around June to September",
      note: "June can be a good fit, but Alor can be current-heavy, so operator style matters",
    };
  }

  if (normalized.includes("wakatobi")) {
    return {
      destination,
      bestWindow:
        "around March to December, with especially steady conditions often from April to November",
      note: "June is usually a sensible window for Wakatobi",
    };
  }

  return {
    destination,
    bestWindow:
      "during Indonesia's drier months, roughly April to October, depending on the exact island chain",
    note: "June is often workable, but the best fit depends on the destination and trip style",
  };
}

function replyAppearsToAskSlot(reply: string, slot: string) {
  const normalized = reply.toLowerCase();
  const questionText = extractQuestionText(normalized);
  const asksQuestion =
    questionText.includes("?") ||
    /\b(can you|could you|tell me|what|where|how many|when)\b/.test(
      questionText,
    );

  if (!asksQuestion) {
    return false;
  }

  if (slot === "destination") {
    return /\b(where|destination|area|place|which island|where in indonesia)\b/.test(
      questionText,
    );
  }

  if (slot === "tripType") {
    return /\b(what kind|trip type|experience|diving|sailing|liveaboard|snorkelling|snorkeling|surf)\b/.test(
      questionText,
    );
  }

  if (slot === "guests") {
    return /\b(how many|guests?|people|travelers|travellers|joining|traveling|travelling)\b/.test(
      questionText,
    );
  }

  if (slot === "dateWindow") {
    return /\b(when|date|month|travel)\b/.test(questionText);
  }

  if (slot === "certificationLevel") {
    return /\b(certification|certified|open water|advanced|rescue|divemaster|instructor)\b/.test(
      questionText,
    );
  }

  if (slot === "travellerName") {
    return /\b(name|who should|traveller|traveler)\b/.test(questionText);
  }

  if (slot === "travellerEmail") {
    return /\b(email|e-mail)\b/.test(questionText);
  }

  if (slot === "travellerPhone") {
    return /\b(phone|whatsapp|contact number)\b/.test(questionText);
  }

  return false;
}

function extractQuestionText(normalizedReply: string) {
  if (!normalizedReply.includes("?")) {
    return normalizedReply;
  }

  return normalizedReply
    .split("?")
    .slice(0, -1)
    .map((part) => part.split(/[.!]/).pop()?.trim() ?? "")
    .filter(Boolean)
    .join("? ");
}

async function loadSessionContextSafely(
  store: KaiConversationStore,
  input: {
    sessionId: string;
    channel: KaiChannel;
    hasProvidedSessionId: boolean;
  },
) {
  if (!input.hasProvidedSessionId) {
    logKaiStage("kai.session.no_session_id_create_started", {
      sessionId: input.sessionId,
      channel: input.channel,
    });
    logKaiStage("kai.session.no_session_id_create_succeeded", {
      sessionId: input.sessionId,
      channel: input.channel,
    });

    return undefined;
  }

  logKaiStage("kai.session.provided_lookup_started", {
    sessionId: input.sessionId,
    channel: input.channel,
  });

  if (!store.getSessionContext) {
    logKaiStage("kai.session.provided_lookup_not_found", {
      sessionId: input.sessionId,
      channel: input.channel,
    });

    return undefined;
  }

  try {
    logKaiStage("kai.session.context_parse_started", {
      sessionId: input.sessionId,
      channel: input.channel,
    });
    const context = await store.getSessionContext({
      sessionId: input.sessionId,
      channel: input.channel,
    });

    if (!context) {
      logKaiStage("kai.session.provided_lookup_not_found", {
        sessionId: input.sessionId,
        channel: input.channel,
      });
      logKaiStage("kai.session.context_parse_succeeded", {
        sessionId: input.sessionId,
        channel: input.channel,
        contextKeys: [],
      });

      return undefined;
    }

    logKaiStage("kai.session.provided_lookup_succeeded", {
      sessionId: input.sessionId,
      channel: input.channel,
    });
    logKaiStage("kai.session.context_parse_succeeded", {
      sessionId: input.sessionId,
      channel: input.channel,
      contextKeys: Object.keys(context),
    });

    return context;
  } catch (error) {
    logReadFailure(
      "kai.session.context_parse_failed",
      input.sessionId,
      input.channel,
      error,
    );

    return undefined;
  }
}

async function loadHistorySafely(
  store: KaiConversationStore,
  input: {
    sessionId: string;
    channel: KaiChannel;
    hasProvidedSessionId: boolean;
  },
) {
  if (!input.hasProvidedSessionId || !store.listMessages) {
    return [];
  }

  logKaiStage("kai.history.load_started", {
    sessionId: input.sessionId,
    channel: input.channel,
  });

  try {
    const messages = await store.listMessages({
      sessionId: input.sessionId,
      channel: input.channel,
      limit: 8,
    });
    const safeMessages = Array.isArray(messages)
      ? messages.filter((message) =>
          isSafeConversationMessage(message, input.channel),
        )
      : [];

    logKaiStage("kai.history.load_succeeded", {
      sessionId: input.sessionId,
      channel: input.channel,
      previousMessageCount: safeMessages.length,
    });

    return safeMessages;
  } catch (error) {
    logReadFailure(
      "kai.history.load_failed",
      input.sessionId,
      input.channel,
      error,
    );

    return [];
  }
}

function isSafeConversationMessage(
  message: unknown,
  channel: KaiChannel,
): message is KaiConversationMessage {
  return (
    message !== null &&
    typeof message === "object" &&
    "channel" in message &&
    "role" in message &&
    "content" in message &&
    message.channel === channel &&
    (message.role === "user" ||
      message.role === "assistant" ||
      message.role === "system") &&
    typeof message.content === "string"
  );
}

function logKaiStage(stage: string, data: Record<string, unknown>) {
  console.info(stage, {
    ...data,
    sessionId: maskSessionId(data.sessionId),
  });
}

function logPersistenceFailure(
  stage: string,
  sessionId: string,
  channel: KaiChannel,
  operation: string,
  error: unknown,
) {
  console.warn("kai.persistence.failed", {
    stage,
    sessionId: maskSessionId(sessionId),
    channel,
    operation,
    errorName: error instanceof Error ? error.name : "UnknownError",
    message:
      error instanceof Error ? error.message : "Unknown persistence error",
    prismaCode: getPrismaErrorCode(error),
  });
}

function logReadFailure(
  stage: string,
  sessionId: string,
  channel: KaiChannel,
  error: unknown,
) {
  console.warn(stage, {
    sessionId: maskSessionId(sessionId),
    channel,
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown read error",
    prismaCode: getPrismaErrorCode(error),
  });
}

function getPrismaErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;

    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

function maskSessionId(sessionId: unknown) {
  if (typeof sessionId !== "string") {
    return undefined;
  }

  return `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}`;
}

function shouldExposePlanner() {
  return (
    process.env.NODE_ENV !== "production" || process.env.KAI_DEBUG === "true"
  );
}

function buildMessage(
  message: Omit<KaiConversationMessage, "id" | "createdAt">,
): KaiConversationMessage {
  return {
    id: `kaimsg_${randomUUID()}`,
    createdAt: new Date(),
    ...message,
  };
}
