/**
 * Resolves traveller references to options Kai has actually shown
 * ("the second one", "option 2", "the Rascal") to a catalog yacht slug.
 *
 * Grounding rules:
 * - References resolve only against options Kai actually displayed, newest
 *   first: the latest assistant message that showed a LIST of two or more
 *   options (its structured matches if it has them, otherwise the numbered
 *   list in its text) - never catalog order, and an older structured list
 *   never beats a newer text-only list.
 * - A single displayed card (a one-match reply, or the card left after a
 *   selection narrows the display) does not erase the earlier list: a
 *   later ordinal still resolves against that list, on every channel. The
 *   single card defines referents only when no list was ever shown, with
 *   this turn's recomputed matches as the final fallback. This keeps the
 *   stored-metadata path (WhatsApp/prisma, metadata survives) consistent
 *   with the web fallback (client round-trips role/content only, so only
 *   numbered reply text is visible) - both scan for the same list.
 * - Partial names resolve against the shown pool first; catalog-wide only
 *   when nothing was ever shown, and only when a single yacht matches.
 * - An explicit reference ("Actually, the second one") may re-select even
 *   after a yacht was chosen, but only against shown referents; when the
 *   reference cannot be grounded the old selection is cleared and Kai
 *   clarifies - the previous boat is never kept as a silent success.
 * - Only referential intent (a name, an ordinal, or a deictic marker like
 *   "that one") can invoke option clarification. Generic booking/date/
 *   party answers ("book for 4 guests in May", "I'd like to book a cabin
 *   for 2 people", "the first of December") are not references and never
 *   interrupt the slot flow.
 */
import { yachts } from "@/lib/data/yachts";
import type { KaiConversationMessage, YachtMatch } from "./types";

export type ShownOption = { slug: string; name: string };

export type OptionReferenceResolution =
  | { kind: "none" }
  | { kind: "resolved"; slug: string }
  | { kind: "clarify"; candidates: ShownOption[]; clearSelection: boolean };

const SELECTION_INTENT =
  /\b(?:interested in|i like|i'?d (?:like|pick|choose|go with)|go with|choose|chose|select|pick)\b/i;

const REFERENCE_MARKER =
  /\b(?:that one|this one|the \w+ one|option\s*\d|(?:number|#)\s*\d|(?:the\s+)?(?:first|second|third)\s+(?:one|option|card|yacht|boat)|(?:the\s+)?(?:first|second|third)\s+of\s+them)\b/i;

const ORDINAL_WORDS: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
};

const REFERENCE_STOPWORDS = new Set([
  "the", "a", "an", "im", "i", "i'm", "id", "i'd", "interested", "in",
  "like", "would", "want", "go", "with", "choose", "chose", "select",
  "pick", "that", "this", "one", "option", "card", "yacht", "boat",
  "first", "second", "third", "lets", "let's", "let", "us", "take",
  "ill", "i'll", "will", "please", "send", "inquiry", "enquiry", "for",
  "me", "my", "we", "our", "of", "them", "number", "think", "actually",
  "make", "it", "its",
  // date / party words so "book for 4 guests in May" never becomes a
  // reference and "first of December" never leaves a stray token:
  "guests", "guest", "people", "person", "pax", "travellers", "travelers",
  "divers", "week", "weeks", "total",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct",
  "nov", "dec",
]);

export function detectOptionSelectionIntent(message: string): boolean {
  return SELECTION_INTENT.test(message) || REFERENCE_MARKER.test(message);
}

const CONFIRMED_SELECTION_TEXT =
  /(?:essentials for an? (.+?) inquiry|Tap Send inquiry on the (.+?) card)/i;

// Kai's deterministic option-clarification replies. A clarification only
// follows a selection reference, and whenever a selection existed the live
// turn cleared it - so in replay this marker means "no boat selected".
const CLARIFICATION_TEXT =
  /(?:which one should I prepare the inquiry for|the only option on the table is)/i;

/**
 * The selection Kai actually CONFIRMED in an assistant message, newest
 * state last: structured metadata.intent.selectedYachtSlug when the store
 * kept it (a stored intent without a slug means the selection was cleared),
 * otherwise the reply text, which is all the web client's role/content-only
 * history preserves: the confirmation wording confirms, the clarification
 * wording clears. Intent reconstruction
 * applies these in order so an older replayed "I'm interested in X" can
 * never resurrect a boat a later correction replaced or cleared.
 */
export function confirmedSelectionFromAssistantMessage(
  message: KaiConversationMessage,
): { slug: string | undefined } | undefined {
  if (message.role !== "assistant") {
    return undefined;
  }

  const metadata = message.metadata as Record<string, unknown> | undefined;
  const metadataIntent = metadata?.intent;

  if (metadataIntent && typeof metadataIntent === "object") {
    const slug = (metadataIntent as Record<string, unknown>).selectedYachtSlug;

    return { slug: typeof slug === "string" ? slug : undefined };
  }

  const text = message.content.match(CONFIRMED_SELECTION_TEXT);
  const name = (text?.[1] ?? text?.[2])?.trim();
  const option = name ? slugForCatalogName(name) : undefined;

  if (option) {
    return { slug: option.slug };
  }

  // On role/content-only history (web) a cleared correction leaves no
  // metadata; the clarification reply itself is the clear event.
  return CLARIFICATION_TEXT.test(message.content)
    ? { slug: undefined }
    : undefined;
}

function extractOrdinal(message: string): number | undefined {
  const wordMatch =
    message.match(
      /\b(?:the\s+)?(first|second|third)\s+(?:one|option|card|yacht|boat)\b/i,
    ) ?? message.match(/\b(?:the\s+)?(first|second|third)\s+of\s+them\b/i);

  if (wordMatch) {
    return ORDINAL_WORDS[wordMatch[1].toLowerCase()];
  }

  const numericMatch = message.match(/\b(?:option|number|card|#)\s*([123])\b/i);

  if (numericMatch) {
    return Number(numericMatch[1]) - 1;
  }

  return undefined;
}

function slugForCatalogName(name: string): ShownOption | undefined {
  const normalized = name.trim().toLowerCase();
  const yacht = yachts.find(
    (item) =>
      item.name.toLowerCase() === normalized ||
      item.slug.replace(/-/g, " ") === normalized,
  );

  return yacht ? { slug: yacht.slug, name: yacht.name } : undefined;
}

function optionsFromMatchList(matches: YachtMatch[]): ShownOption[] {
  return matches.map((match) => ({ slug: match.slug, name: match.name }));
}

function optionsFromMetadata(message: KaiConversationMessage): ShownOption[] {
  const raw = (message.metadata as Record<string, unknown> | undefined)?.matches;

  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  const options: ShownOption[] = [];

  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;

      if (typeof record.slug === "string" && typeof record.name === "string") {
        options.push({ slug: record.slug, name: record.name });
      }
    }
  }

  return options;
}

function optionsFromText(message: KaiConversationMessage): ShownOption[] {
  const options: ShownOption[] = [];
  const numbered = message.content.matchAll(
    /(?:^|\n)\s*\d\.\s+([A-Z][^,\n]{1,60}),/g,
  );

  for (const match of numbered) {
    const option = slugForCatalogName(match[1]);

    if (option) {
      options.push(option);
    }
  }

  return options;
}

/**
 * The options the traveller most recently SAW as a list, newest assistant
 * message first: structured matches when that message has them, else its
 * numbered text list. A single displayed card (a one-match reply or a
 * selection-narrowed display) is not a list: it is remembered only as a
 * fallback, ahead of this turn's recomputed matches, for when no list was
 * ever shown. This mirrors what the web fallback does naturally (a
 * one-card reply carries no numbered text), so both channels resolve
 * ordinals against the same list.
 */
export function collectShownOptions(
  matches: YachtMatch[],
  memory: KaiConversationMessage[],
): ShownOption[] {
  let singleOptionDisplay: ShownOption[] = [];

  for (const message of [...memory].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }

    const fromMetadata = optionsFromMetadata(message);
    const options =
      fromMetadata.length > 0 ? fromMetadata : optionsFromText(message);

    if (options.length >= 2) {
      return options;
    }

    if (options.length === 1 && singleOptionDisplay.length === 0) {
      singleOptionDisplay = options;
    }
  }

  return singleOptionDisplay.length > 0
    ? singleOptionDisplay
    : optionsFromMatchList(matches);
}

function extractReferenceTokens(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !REFERENCE_STOPWORDS.has(token));
}

function matchTokensAgainst(
  tokens: string[],
  pool: ShownOption[],
): ShownOption[] {
  if (tokens.length === 0) {
    return [];
  }

  return pool.filter((option) => {
    const haystack = `${option.name} ${option.slug.replace(/-/g, " ")}`.toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

export function resolveOptionReference(input: {
  message: string;
  selectedYachtSlug?: string;
  matches: YachtMatch[];
  memory: KaiConversationMessage[];
}): OptionReferenceResolution {
  const hasMarker = REFERENCE_MARKER.test(input.message);
  const hasIntent = SELECTION_INTENT.test(input.message) || hasMarker;

  if (!hasIntent) {
    return { kind: "none" };
  }

  // An existing selection stays unless the traveller makes an explicit
  // reference against the shown options (a correction).
  if (input.selectedYachtSlug && !hasMarker) {
    return { kind: "none" };
  }

  const shown = collectShownOptions(input.matches, input.memory);
  const ordinal = extractOrdinal(input.message);

  if (ordinal !== undefined) {
    if (ordinal < shown.length) {
      return { kind: "resolved", slug: shown[ordinal].slug };
    }

    return shown.length > 0
      ? { kind: "clarify", candidates: shown, clearSelection: true }
      : { kind: "none" };
  }

  const tokens = extractReferenceTokens(input.message);

  if (tokens.length > 0) {
    const pool =
      shown.length > 0
        ? shown
        : yachts.map((yacht) => ({ slug: yacht.slug, name: yacht.name }));
    const candidates = matchTokensAgainst(tokens, pool);

    if (candidates.length === 1) {
      return { kind: "resolved", slug: candidates[0].slug };
    }

    if (candidates.length > 1) {
      return {
        kind: "clarify",
        candidates,
        clearSelection: hasMarker || Boolean(input.selectedYachtSlug),
      };
    }

    // Tokens named nothing shown and nothing in the catalog. Only a
    // referential gesture ("that one", "the phinisi one") asks which of
    // the shown options was meant; a generic booking phrase ("I'd like to
    // book a cabin for 2 people") is not a reference and leaves the slot
    // flow alone.
    return hasMarker && shown.length > 0
      ? { kind: "clarify", candidates: shown, clearSelection: true }
      : { kind: "none" };
  }

  // Bare gesture ("that one", "I'm interested") with no ordinal or name.
  if (shown.length === 1) {
    return { kind: "resolved", slug: shown[0].slug };
  }

  return shown.length > 0
    ? { kind: "clarify", candidates: shown, clearSelection: hasMarker }
    : { kind: "none" };
}
