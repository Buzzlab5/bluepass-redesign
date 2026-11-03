import { describe, expect, it } from "vitest";
import type { KaiConversationMessage, YachtMatch } from "./types";
import { resolveOptionReference } from "./option-reference";

const shownMatches = [
  { slug: "rascal", name: "Rascal" },
  { slug: "samara-i", name: "Samara I" },
  { slug: "calico-jack", name: "Calico Jack" },
] as YachtMatch[];

const assistantCardMessage: KaiConversationMessage = {
  sessionId: "s",
  channel: "web",
  role: "assistant",
  content:
    "Based on the current BluePass preview fleet, I'd start with these matches:\n" +
    "1. Rascal, cabin price signal: $2,500; Komodo route.\n" +
    "2. Samara I, cabin price signal: $1,690; Komodo route.\n" +
    "3. Calico Jack, cabin price signal: $3,200; Komodo route.",
};

const assistantMetadataMessage: KaiConversationMessage = {
  sessionId: "s",
  channel: "web",
  role: "assistant",
  content: "Here are your matches.",
  metadata: { matches: shownMatches },
};

const userMessage: KaiConversationMessage = {
  sessionId: "s",
  channel: "web",
  role: "user",
  content: "thanks",
};

describe("ordinals resolve against what was actually shown, newest first", () => {
  it("falls back to this turn's matches only when nothing was shown before", () => {
    const result = resolveOptionReference({
      message: "I'll go with the first one",
      matches: shownMatches,
      memory: [],
    });

    expect(result).toEqual({ kind: "resolved", slug: "rascal" });
  });

  it("resolves 'option 2' against stored assistant metadata", () => {
    const result = resolveOptionReference({
      message: "option 2 please",
      matches: [],
      memory: [assistantMetadataMessage],
    });

    expect(result).toEqual({ kind: "resolved", slug: "samara-i" });
  });

  it("resolves ordinals from the numbered list in Kai's last reply", () => {
    const result = resolveOptionReference({
      message: "I'll take the second option",
      matches: [],
      memory: [assistantCardMessage],
    });

    expect(result).toEqual({ kind: "resolved", slug: "samara-i" });
  });

  it("a NEWER text-only list beats an OLDER structured metadata list", () => {
    const newerTextList: KaiConversationMessage = {
      sessionId: "s",
      channel: "web",
      role: "assistant",
      content:
        "Here are updated matches:\n" +
        "1. Samara I, cabin price signal: $1,690; Komodo route.\n" +
        "2. Bajak, cabin price signal: Quote on request; Komodo route.",
    };

    const result = resolveOptionReference({
      message: "the first one",
      matches: [],
      memory: [assistantMetadataMessage, userMessage, newerTextList],
    });

    expect(result).toEqual({ kind: "resolved", slug: "samara-i" });
  });

  it("recomputed this-turn matches never beat the actually shown list", () => {
    const recomputed = [
      { slug: "bajak", name: "Bajak" },
      { slug: "rascal", name: "Rascal" },
    ] as YachtMatch[];

    const result = resolveOptionReference({
      message: "the second one",
      matches: recomputed,
      memory: [assistantMetadataMessage],
    });

    // Shown order was Rascal, Samara I, Calico Jack - not the recomputed order.
    expect(result).toEqual({ kind: "resolved", slug: "samara-i" });
  });

  it("clarifies and flags clearing when the ordinal is out of range", () => {
    const result = resolveOptionReference({
      message: "the third one",
      selectedYachtSlug: "rascal",
      matches: shownMatches.slice(0, 2),
      memory: [],
    });

    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") {
      expect(result.candidates.map((c) => c.name)).toEqual(["Rascal", "Samara I"]);
      expect(result.clearSelection).toBe(true);
    }
  });
});

describe("date phrases and generic booking messages are not references", () => {
  it.each([
    "the first of December",
    "second of March",
    "first two weeks of December 2026",
    "book for 4 guests in May",
    "December 2026",
  ])("%s -> none", (message) => {
    const result = resolveOptionReference({
      message,
      matches: shownMatches,
      memory: [assistantMetadataMessage],
    });

    expect(result.kind).toBe("none");
  });
});

describe("corrections against the shown referents", () => {
  it("'Actually, the second one' re-selects even with a slug already set", () => {
    const result = resolveOptionReference({
      message: "Actually, the second one",
      selectedYachtSlug: "rascal",
      matches: [],
      memory: [assistantMetadataMessage],
    });

    expect(result).toEqual({ kind: "resolved", slug: "samara-i" });
  });

  it("an ungroundable correction clarifies and clears the old selection", () => {
    const result = resolveOptionReference({
      message: "that one",
      selectedYachtSlug: "rascal",
      matches: shownMatches,
      memory: [],
    });

    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") {
      expect(result.clearSelection).toBe(true);
      expect(result.candidates).toHaveLength(3);
    }
  });

  it("a set slug with no reference marker is left alone", () => {
    const result = resolveOptionReference({
      message: "sounds good, preparing documents",
      selectedYachtSlug: "rascal",
      matches: shownMatches,
      memory: [],
    });

    expect(result.kind).toBe("none");
  });
});

describe("partial names", () => {
  it("resolves a unique partial name from the shown options", () => {
    const result = resolveOptionReference({
      message: "the Rascal one",
      matches: shownMatches,
      memory: [],
    });

    expect(result).toEqual({ kind: "resolved", slug: "rascal" });
  });

  it("clarifies an ambiguous catalog-wide partial name instead of guessing", () => {
    const result = resolveOptionReference({
      message: "I'm interested in the Mermaid",
      matches: [],
      memory: [],
    });

    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") {
      expect(result.candidates.map((c) => c.name)).toEqual(
        expect.arrayContaining(["Mermaid I", "Mermaid II"]),
      );
      expect(result.clearSelection).toBe(false);
    }
  });

  it("leaves generic booking phrases out of option clarification", () => {
    // "book a cabin" is not a name/ordinal/deictic reference: zero matching
    // tokens and no marker means the slot flow continues untouched.
    for (const message of [
      "I'd like to book a cabin for 2 people",
      "I'm interested in the Black Pearl",
    ]) {
      const result = resolveOptionReference({
        message,
        matches: shownMatches,
        memory: [assistantMetadataMessage],
      });

      expect(result.kind).toBe("none");
    }
  });

  it("clarifies a marker-backed reference that matches nothing shown", () => {
    const result = resolveOptionReference({
      message: "Actually, the phinisi one",
      selectedYachtSlug: "rascal",
      matches: shownMatches,
      memory: [assistantMetadataMessage],
    });

    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") {
      expect(result.candidates.map((c) => c.name)).toEqual([
        "Rascal",
        "Samara I",
        "Calico Jack",
      ]);
      expect(result.clearSelection).toBe(true);
    }
  });
});

describe("a single displayed card never erases the earlier list", () => {
  const narrowedCardMessage: KaiConversationMessage = {
    sessionId: "s",
    channel: "whatsapp",
    role: "assistant",
    content:
      "Great, I have the essentials for a Rascal inquiry: Komodo, 4 guests, December 2026, $8,000. Tap Send inquiry on the Rascal card and I'll send it to the operator.",
    metadata: { matches: shownMatches.slice(0, 1) },
  };

  it("an ordinal after a selection resolves the earlier list (stored metadata path)", () => {
    // WhatsApp/prisma keeps structured metadata; the newest assistant message
    // is the narrowed one-card display. The web fallback finds the earlier
    // numbered list because that reply has no numbered text - the stored
    // path must resolve the same list.
    const result = resolveOptionReference({
      message: "Actually, the third one",
      selectedYachtSlug: "rascal",
      matches: [],
      memory: [assistantMetadataMessage, userMessage, narrowedCardMessage],
    });

    expect(result).toEqual({ kind: "resolved", slug: "calico-jack" });
  });

  it("a single shown card still defines referents when no list was ever shown", () => {
    const result = resolveOptionReference({
      message: "that one",
      matches: [],
      memory: [narrowedCardMessage],
    });

    expect(result).toEqual({ kind: "resolved", slug: "rascal" });
  });

  it("this turn's recomputed matches stay the final fallback", () => {
    const result = resolveOptionReference({
      message: "the second one",
      matches: shownMatches,
      memory: [narrowedCardMessage],
    });

    // Single displayed card (Rascal) has no ordinal 2; it beats recomputed
    // only as the referent pool, so ordinal 2 is out of range and clarifies.
    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") {
      expect(result.candidates).toEqual([{ slug: "rascal", name: "Rascal" }]);
    }
  });
});

describe("bare gestures", () => {
  it("resolves 'that one' when exactly one option was shown", () => {
    const result = resolveOptionReference({
      message: "that one",
      matches: shownMatches.slice(0, 1),
      memory: [],
    });

    expect(result).toEqual({ kind: "resolved", slug: "rascal" });
  });

  it("does nothing for 'that one' with no options anywhere", () => {
    const result = resolveOptionReference({
      message: "that one",
      matches: [],
      memory: [],
    });

    expect(result.kind).toBe("none");
  });

  it("stays out of non-selection messages", () => {
    const result = resolveOptionReference({
      message: "I want a dive-focused liveaboard",
      matches: shownMatches,
      memory: [],
    });

    expect(result.kind).toBe("none");
  });
});
