import { describe, expect, it } from "vitest";
import {
  createKaiConversationService,
  type KaiConversationStore,
} from "./conversation-service";
import type {
  KaiConversationMessage,
  KaiSessionContext,
  KaiTravelIntent,
} from "./types";

type Turn = { reply: string; intent: KaiTravelIntent; matches: { slug: string; name: string }[] };

async function runScript(
  service: ReturnType<typeof createKaiConversationService>,
  sessionId: string,
  messages: string[],
  options: { threadClientHistory?: boolean; travellerProfile?: object } = {},
): Promise<Turn[]> {
  const turns: Turn[] = [];
  const history: Array<Pick<KaiConversationMessage, "role" | "content">> = [];

  for (const message of messages) {
    const result = await service.handleUserMessage({
      sessionId,
      channel: "web",
      message,
      ...(options.threadClientHistory ? { recentMessages: history.slice(-12) } : {}),
      ...(options.travellerProfile ? { travellerProfile: options.travellerProfile as never } : {}),
    });

    turns.push({
      reply: result.reply,
      intent: result.intent,
      matches: (result.matches ?? []) as Turn["matches"],
    });
    history.push(
      { role: "user", content: message },
      { role: "assistant", content: result.reply },
    );
  }

  return turns;
}

class MemoryStore implements KaiConversationStore {
  context?: KaiSessionContext;
  messages: KaiConversationMessage[] = [];
  contextAvailable = true;

  async upsertSession(session: { context?: KaiSessionContext }) {
    this.context = session.context;
  }

  async addMessage(message: KaiConversationMessage) {
    this.messages.push(message);
  }

  async persistTurn(input: {
    session: { context?: KaiSessionContext };
    messages: KaiConversationMessage[];
  }) {
    this.context = input.session.context;
    this.messages.push(...input.messages);
  }

  async getSessionContext() {
    return this.contextAvailable ? this.context : undefined;
  }

  async listMessages(input: { limit?: number }) {
    return this.messages.slice(-(input.limit ?? 50));
  }
}

describe("web-style conversation (no store, client threads last 12 messages)", () => {
  it("captures name, then email, then phone from the combined contact ask, even across an advice detour", async () => {
    const service = createKaiConversationService();
    const turns = await runScript(
      service,
      "kai_test_contact",
      [
        "Hi! We're thinking about a dive trip in Indonesia",
        "Komodo, dive-focused",
        "4 guests",
        "First two weeks of December 2026",
        "Around $8,000 total",
        "What is the best time to go to Komodo?",
        "Anthony Cargill",
        "anthony@example.com",
        "+61 422 755 457",
      ],
      { threadClientHistory: true },
    );

    expect(turns[6].intent.travellerName).toBe("Anthony Cargill");
    expect(turns[6].reply).toContain("email");
    expect(turns[6].reply).not.toContain("What name");
    expect(turns[7].intent.travellerEmail).toBe("anthony@example.com");
    expect(turns[8].intent.travellerPhone).toBeDefined();
    // All slots complete: options arrive as cards with per-yacht suggestions.
    expect(turns[8].matches.length).toBeGreaterThan(0);
    expect(turns[8].reply).toContain("preview fleet");
  });

  it("never turns a travel year into the budget", async () => {
    const service = createKaiConversationService();
    const turns = await runScript(
      service,
      "kai_test_budget",
      ["Komodo liveaboard for diving, 4 guests, first two weeks of December 2026, budget around $8,000"],
      { travellerProfile: { id: "t1", name: "Anthony Cargill", email: "anthony@example.com", phone: "+61422755457" } },
    );

    expect(turns[0].intent.budget).toBeDefined();
    expect(turns[0].intent.budget).toContain("8,000");
    expect(turns[0].intent.budget).not.toMatch(/^20\d\d$/);
    expect(turns[0].matches.length).toBeGreaterThan(0);
  });
});

describe("reference resolution in conversation", () => {
  const profile = {
    id: "t1",
    name: "Anthony Cargill",
    email: "anthony@example.com",
    phone: "+61422755457",
  };
  const opening =
    "Komodo liveaboard for diving, 4 guests, first two weeks of December 2026, budget around $8,000";

  it("resolves 'the second one' to the second shown card", async () => {
    const service = createKaiConversationService();
    const history: Array<Pick<KaiConversationMessage, "role" | "content">> = [];
    const first = await service.handleUserMessage({
      sessionId: "kai_test_ordinal",
      channel: "web",
      message: opening,
      travellerProfile: profile as never,
    });
    history.push(
      { role: "user", content: opening },
      { role: "assistant", content: first.reply },
    );
    const shown = (first.matches ?? []) as { slug: string; name: string }[];
    expect(shown.length).toBeGreaterThanOrEqual(2);

    const second = await service.handleUserMessage({
      sessionId: "kai_test_ordinal",
      channel: "web",
      message: "I'll go with the second one",
      recentMessages: history,
      travellerProfile: profile as never,
    });

    expect(second.intent.selectedYachtSlug).toBe(shown[1].slug);
    expect(second.reply).toContain(shown[1].name);
    expect(second.reply).toContain("Tap Send inquiry");
  });

  it("lets an explicit correction re-select against the shown cards", async () => {
    const service = createKaiConversationService();
    const history: Array<Pick<KaiConversationMessage, "role" | "content">> = [];
    const send = async (message: string) => {
      const result = await service.handleUserMessage({
        sessionId: "kai_test_correction",
        channel: "web",
        message,
        recentMessages: history.slice(-12),
        travellerProfile: profile as never,
      });
      history.push(
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      );
      return result;
    };

    const first = await send(opening);
    const shown = (first.matches ?? []) as { slug: string; name: string }[];
    expect(shown.length).toBeGreaterThanOrEqual(2);

    const picked = await send(`I'm interested in ${shown[0].name}`);
    expect(picked.intent.selectedYachtSlug).toBe(shown[0].slug);

    const corrected = await send("Actually, the second one");
    expect(corrected.intent.selectedYachtSlug).toBe(shown[1].slug);
    expect(corrected.reply).toContain(shown[1].name);

    // The correction survives the next generic turn on the web path too:
    // the confirmation wording in Kai's reply text is the referent there.
    const cabin = await send("I'd like to book a cabin for 2 people");
    expect(cabin.intent.selectedYachtSlug).toBe(shown[1].slug);
    expect(cabin.reply).toContain(shown[1].name);
    expect(cabin.reply).not.toContain("which one");
  });

  it("clears the old selection and clarifies when a correction cannot be grounded", async () => {
    const service = createKaiConversationService();
    const history: Array<Pick<KaiConversationMessage, "role" | "content">> = [];
    const send = async (message: string) => {
      const result = await service.handleUserMessage({
        sessionId: "kai_test_bad_correction",
        channel: "web",
        message,
        recentMessages: history.slice(-12),
        travellerProfile: profile as never,
      });
      history.push(
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      );
      return result;
    };

    const first = await send(opening);
    const shown = (first.matches ?? []) as { slug: string; name: string }[];

    const picked = await send(`I'm interested in ${shown[0].name}`);
    expect(picked.intent.selectedYachtSlug).toBe(shown[0].slug);

    // "that one" cannot be grounded against three shown cards: the old boat
    // must not survive as a silent success.
    const bad = await send("that one");
    expect(bad.intent.selectedYachtSlug).toBeUndefined();
    expect(bad.reply).toContain("which one");
  });

  it("keeps the slot flow for generic booking and date messages after options were shown", async () => {
    const service = createKaiConversationService();
    const history: Array<Pick<KaiConversationMessage, "role" | "content">> = [];
    const send = async (message: string) => {
      const result = await service.handleUserMessage({
        sessionId: "kai_test_generic",
        channel: "web",
        message,
        recentMessages: history.slice(-12),
        travellerProfile: profile as never,
      });
      history.push(
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      );
      return result;
    };

    await send(opening);
    const dateAnswer = await send("the first of December works");
    expect(dateAnswer.intent.selectedYachtSlug).toBeUndefined();
    expect(dateAnswer.reply).not.toContain("which one");

    const generic = await send("book for 4 guests in May");
    expect(generic.intent.selectedYachtSlug).toBeUndefined();
    expect(generic.reply).not.toContain("which one");
  });

  it("keeps 'I'd like to book a cabin for 2 people' in the slot flow, not option clarification", async () => {
    const service = createKaiConversationService();
    const history: Array<Pick<KaiConversationMessage, "role" | "content">> = [];
    const send = async (message: string) => {
      const result = await service.handleUserMessage({
        sessionId: "kai_test_cabin",
        channel: "web",
        message,
        recentMessages: history.slice(-12),
        travellerProfile: profile as never,
      });
      history.push(
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      );
      return result;
    };

    const first = await send(opening);
    expect((first.matches ?? []).length).toBeGreaterThanOrEqual(2);

    // A generic booking phrase with no name/ordinal/deictic marker must not
    // ask which boat; the slot update (guests 4 -> 2) still lands.
    const cabin = await send("I'd like to book a cabin for 2 people");
    expect(cabin.intent.selectedYachtSlug).toBeUndefined();
    expect(cabin.intent.guests).toBe(2);
    expect(cabin.reply).not.toContain("which one");
  });

  it("a cleared correction never brings the old boat back on later generic turns (web)", async () => {
    // Reviewer repro: web history is role/content only, so the clear must be
    // reconstructed from that context alone - fail closed, never resurrect.
    const service = createKaiConversationService();
    const history: Array<Pick<KaiConversationMessage, "role" | "content">> = [];
    const send = async (message: string) => {
      const result = await service.handleUserMessage({
        sessionId: "kai_test_clear_replay",
        channel: "web",
        message,
        recentMessages: history.slice(-12),
        travellerProfile: profile as never,
      });
      history.push(
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      );
      return result;
    };

    const first = await send(opening);
    const shown = (first.matches ?? []) as { slug: string; name: string }[];
    expect(shown.length).toBeGreaterThanOrEqual(3);

    const picked = await send(`I'm interested in ${shown[0].name}`);
    expect(picked.intent.selectedYachtSlug).toBe(shown[0].slug);

    // U1: out-of-range numeric correction clears, then a generic turn must
    // not resurrect the old boat.
    const clearedU1 = await send("option 4");
    expect(clearedU1.intent.selectedYachtSlug).toBeUndefined();
    const afterU1 = await send("I'd like to book a cabin for 2 people");
    expect(afterU1.intent.selectedYachtSlug).toBeUndefined();
    expect(afterU1.intent.guests).toBe(2);
    expect(afterU1.reply).not.toContain(`for a ${shown[0].name} inquiry`);

    // Later explicit reselection still works after the clear...
    const reselected = await send(`I'm interested in ${shown[1].name}`);
    expect(reselected.intent.selectedYachtSlug).toBe(shown[1].slug);
    // ...and survives its own following generic turn.
    const afterReselect = await send("I'd like to book a cabin for 3 people");
    expect(afterReselect.intent.selectedYachtSlug).toBe(shown[1].slug);

    // U2: ambiguous deictic correction clears, generic turn stays clear.
    const clearedU2 = await send("that one");
    expect(clearedU2.intent.selectedYachtSlug).toBeUndefined();
    const afterU2 = await send("I'd like to book a cabin for 2 people");
    expect(afterU2.intent.selectedYachtSlug).toBeUndefined();

    // U3: out-of-range ordinal correction clears, slot update still lands.
    const pickedAgain = await send(`I'm interested in ${shown[0].name}`);
    expect(pickedAgain.intent.selectedYachtSlug).toBe(shown[0].slug);
    const clearedU3 = await send("the fifth one");
    expect(clearedU3.intent.selectedYachtSlug).toBeUndefined();
    const afterU3 = await send("I'd like to book a cabin for 5 people");
    expect(afterU3.intent.selectedYachtSlug).toBeUndefined();
    expect(afterU3.intent.guests).toBe(5);
  });

  it("clarifies an ambiguous partial name instead of guessing", async () => {
    const service = createKaiConversationService();
    const result = await service.handleUserMessage({
      sessionId: "kai_test_ambiguous",
      channel: "web",
      message: "I'm interested in the Mermaid",
      travellerProfile: profile as never,
    });

    expect(result.intent.selectedYachtSlug).toBeUndefined();
    expect(result.reply).toContain("Mermaid I");
    expect(result.reply).toContain("Mermaid II");
    expect(result.reply).toContain("which one");
  });

  it("keeps 'I want a dive-focused liveaboard' as a trip type, not a selection", async () => {
    const service = createKaiConversationService();
    const result = await service.handleUserMessage({
      sessionId: "kai_test_nonselection",
      channel: "web",
      message: "I want a dive-focused liveaboard",
    });

    // Existing extractor quirk (not in scope to redesign): "dive-focused
    // liveaboard" extracts the trip type "liveaboard" because that alias is
    // checked first. The point of this test: it is NOT treated as a yacht
    // selection.
    expect(result.intent.tripType).toBe("liveaboard");
    expect(result.intent.selectedYachtSlug).toBeUndefined();
  });
});

describe("store-backed conversation (production path)", () => {
  it("retains early slots past the 12-message window even when saved context is unavailable", async () => {
    const store = new MemoryStore();
    store.contextAvailable = false; // legacy session / context read failure
    const service = createKaiConversationService(store);
    const turns = await runScript(
      service,
      "kai_test_store_retention",
      [
        "Komodo, dive-focused",
        "4 guests",
        "First two weeks of December 2026",
        "Around $8,000 total",
        "Anthony Cargill",
        "anthony@example.com",
        "+61 422 755 457",
      ],
      // no client history threading: server relies on stored messages alone
    );

    const final = turns[6];
    expect(final.intent.destination).toBe("Komodo");
    expect(final.intent.tripType).toBe("diving");
    expect(final.intent.guests).toBe(4);
    expect(final.intent.dateWindow).toContain("December 2026");
    expect(final.intent.budget).toContain("8,000");
    expect(final.intent.travellerName).toBe("Anthony Cargill");
    expect(final.matches.length).toBeGreaterThan(0);
  });

  it("retains slots through stored context across a long conversation", async () => {
    const store = new MemoryStore();
    const service = createKaiConversationService(store);
    const script = [
      "Komodo, dive-focused",
      "4 guests",
      "First two weeks of December 2026",
      "Around $8,000 total",
      "Anthony Cargill",
      "anthony@example.com",
    ];

    for (let i = 0; i < script.length; i++) {
      await service.handleUserMessage({
        sessionId: "kai_test_store_context",
        channel: "web",
        message: script[i],
      });
    }

    const final = await service.handleUserMessage({
      sessionId: "kai_test_store_context",
      channel: "web",
      message: "+61 422 755 457",
    });

    expect(final.intent.tripType).toBe("diving");
    expect(final.intent.guests).toBe(4);
    expect(final.intent.dateWindow).toContain("December 2026");
    expect((final.matches ?? []).length).toBeGreaterThan(0);
  });

  it("resolves an ordinal correction against the earlier list after a selection narrows the cards", async () => {
    // The store keeps structured metadata, so the newest assistant message
    // after a selection is the narrowed one-card display. Web (role/content
    // only) resolves the earlier numbered list here; the stored-metadata
    // path must behave the same.
    const store = new MemoryStore();
    const service = createKaiConversationService(store);
    const send = async (message: string) =>
      service.handleUserMessage({
        sessionId: "kai_test_store_ordinal",
        channel: "web",
        message,
        travellerProfile: {
          id: "t1",
          name: "Anthony Cargill",
          email: "anthony@example.com",
          phone: "+61422755457",
        } as never,
      });

    const first = await send(
      "Komodo liveaboard for diving, 4 guests, first two weeks of December 2026, budget around $8,000",
    );
    const shown = (first.matches ?? []) as { slug: string; name: string }[];
    expect(shown.length).toBeGreaterThanOrEqual(3);

    const picked = await send(`I'm interested in ${shown[0].name}`);
    expect(picked.intent.selectedYachtSlug).toBe(shown[0].slug);

    const corrected = await send("Actually, the third one");
    expect(corrected.intent.selectedYachtSlug).toBe(shown[2].slug);
    expect(corrected.reply).toContain(shown[2].name);

    // The correction must survive the next generic turn: replaying the older
    // "I'm interested in X" from history must not resurrect the replaced boat.
    const cabin = await send("I'd like to book a cabin for 2 people");
    expect(cabin.intent.selectedYachtSlug).toBe(shown[2].slug);
    expect(cabin.intent.guests).toBe(2);
    expect(cabin.reply).toContain(shown[2].name);
    expect(cabin.reply).not.toContain("which one");

    // An ordinal beyond anything ever shown is ungroundable: clarify and
    // clear, never keep the old boat as a silent success.
    const ungroundable = await send("Actually, the ninth one");
    expect(ungroundable.intent.selectedYachtSlug).toBeUndefined();
    expect(ungroundable.reply).toContain("which one");
  });
});
