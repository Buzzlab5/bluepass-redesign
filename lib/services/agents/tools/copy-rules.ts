/**
 * The copy rules, as code.
 *
 * These are the owner's standing guardrails, not style preferences, and
 * they are mechanical enough to check deterministically: no model, no cost,
 * no chance of a model talking itself into an exception. Every agent that
 * drafts anything outbound runs its draft through `checkCopy` before it
 * sends, and a `block` result means the draft does not go out.
 *
 * The judgement calls that cannot be a regex — an invented claim, an
 * unverifiable credential, an image whose rights are unresolved — are the
 * Verifier agent's job, and it runs on top of this.
 *
 * Rules, and why each exists:
 *   - Only one percentage ever reaches a customer or an operator: the fixed
 *     5% of every booking that goes to ocean conservation. The commission
 *     band is internal.
 *   - No price-match promise: it is an unbounded liability against a capped
 *     take rate. "No markup" and "your own rates" say the true thing.
 *   - Never "keep 100%": operators keep most of the fare, not all of it,
 *     and the honest framing is "more stays with the crew".
 *   - No emojis, no em dashes.
 *   - Conservation is 5% of the booking, never 5% of the commission or of
 *     profit. Getting this wrong misstates the promise.
 */

export type CopyAudience = "customer" | "operator" | "partner" | "internal";

export type CopyViolation = {
  rule: string;
  severity: "block" | "warn";
  message: string;
  excerpt: string;
  index: number;
};

export type CopyCheckResult = {
  pass: boolean;
  blocking: CopyViolation[];
  warnings: CopyViolation[];
};

/** Emoji and pictographs. Typographic symbols (→ · ✓ ✕ △ ›) stay legal. */
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/** Arrows and a few marks we deliberately allow from the ranges above. */
const ALLOWED_SYMBOLS = new Set(["→", "←", "↑", "↓", "✓", "✕", "△", "›", "‹", "·", "≈"]);

const WORD_NUMBERS =
  "(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)";

type Rule = {
  id: string;
  severity: "block" | "warn";
  message: string;
  audiences?: CopyAudience[];
  /** Returns every match as [excerpt, index]. */
  find: (text: string) => [string, number][];
};

function regexFinder(re: RegExp): (text: string) => [string, number][] {
  return (text) => {
    const out: [string, number][] = [];
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      out.push([m[0], m.index]);
      if (m[0].length === 0) r.lastIndex++;
    }
    return out;
  };
}

const EXTERNAL: CopyAudience[] = ["customer", "operator", "partner"];

export const COPY_RULES: Rule[] = [
  {
    id: "no-emoji",
    severity: "block",
    message: "No emojis. Use a typographic symbol (→ · ✓ ✕) or nothing.",
    find: (text) => {
      const out: [string, number][] = [];
      const r = new RegExp(EMOJI.source, "gu");
      let m: RegExpExecArray | null;
      while ((m = r.exec(text)) !== null) {
        if (!ALLOWED_SYMBOLS.has(m[0])) out.push([m[0], m.index]);
      }
      return out;
    },
  },
  {
    id: "no-em-dash",
    severity: "block",
    message: "No em dashes. Restructure the sentence or use a colon.",
    find: regexFinder(/—|\s–\s/g),
  },
  {
    id: "only-conservation-percentage",
    severity: "block",
    audiences: EXTERNAL,
    message:
      "The only percentage that may appear in external copy is the fixed 5% of every booking that goes to ocean conservation.",
    find: (text) => {
      const out: [string, number][] = [];
      const r = /(\d{1,3}(?:\.\d+)?)\s*(%|per\s?cent\b|percent\b)/gi;
      let m: RegExpExecArray | null;
      while ((m = r.exec(text)) !== null) {
        if (Number(m[1]) === 5) continue;
        out.push([m[0], m.index]);
      }
      const words = new RegExp(`\\b${WORD_NUMBERS}(\\s|-)?${WORD_NUMBERS}?\\s+per\\s?cent\\b`, "gi");
      let w: RegExpExecArray | null;
      while ((w = words.exec(text)) !== null) {
        if (/\bfive\s+per\s?cent\b/i.test(w[0])) continue;
        out.push([w[0], w.index]);
      }
      return out;
    },
  },
  {
    id: "no-price-match",
    severity: "block",
    message:
      "Never promise a price match: it is unbounded liability. Say 'no markup', 'operator-direct' or 'their own rates'.",
    find: regexFinder(
      /price[\s-]?match(?:ed|ing)?|match(?:ing)?\s+any\s+price|beat\s+any\s+(?:price|quote)|lowest[\s-]price\s+guarantee(?:d)?|cheapest\s+guarantee(?:d)?|guarantee(?:d)?\s+the\s+lowest/gi,
    ),
  },
  {
    id: "no-keep-everything",
    severity: "block",
    message:
      "Operators do not keep the whole fare. Say 'you set your own rates', 'we never mark you up', 'more stays with the crew'.",
    find: regexFinder(
      /keep\s+(?:100\s*%|100\s*per\s?cent|all\s+of\s+(?:the|your)\s+(?:fare|money|booking)|everything|every\s+cent|the\s+full\s+(?:fare|amount))|no\s+commission\s+at\s+all|we\s+take\s+nothing/gi,
    ),
  },
  {
    id: "conservation-is-of-the-booking",
    severity: "block",
    audiences: EXTERNAL,
    message:
      "Conservation is 5% of the booking, never 5% of the commission, the profit or the fee.",
    find: regexFinder(
      /5\s*%\s*(?:of\s+)?(?:our\s+|the\s+|your\s+)?(?:commission|profit|profits|margin|fee|fees|take|revenue\s+share)/gi,
    ),
  },
  {
    id: "no-human-impersonation",
    severity: "block",
    audiences: EXTERNAL,
    message:
      "Never claim to be a person. Say you are the BluePass concierge and that a teammate is looped in when needed.",
    find: regexFinder(
      /\b(?:i\s?am|i'm)\s+(?:a\s+)?(?:human|real\s+person|not\s+a\s+(?:bot|robot|an?\s+ai))|\byes,?\s+i\s?am\s+human\b/gi,
    ),
  },
  {
    id: "unsourced-performance-claim",
    severity: "warn",
    audiences: EXTERNAL,
    message:
      "This reads as a performance claim. BluePass has no case-study numbers yet, so it needs a real source or it must come out.",
    find: regexFinder(
      /\b(?:increase[sd]?|boost(?:ed)?|grew|grow(?:n|s)?|lift(?:ed)?|double[sd]?|triple[sd]?)\s+(?:your\s+|their\s+|our\s+)?(?:bookings|revenue|occupancy|sales)|\baverage\s+operator\s+(?:earns|makes|sees)|\bmost\s+operators\s+(?:earn|make|see)|\b\d[\d,.]*\s*(?:x|times)\s+more\s+bookings/gi,
    ),
  },
  {
    id: "unverified-superlative",
    severity: "warn",
    audiences: EXTERNAL,
    message:
      "Superlative claim with nothing behind it. Cut it, or state the verifiable fact instead.",
    find: regexFinder(
      /\b(?:the\s+)?(?:world'?s|australia'?s|indonesia'?s)\s+(?:largest|biggest|leading|best|number\s+one|#1)\b|\b(?:largest|biggest|leading)\s+(?:marine|ocean|dive)\s+(?:marketplace|platform|network)\b/gi,
    ),
  },
];

export function checkCopy(
  text: string,
  opts: { audience?: CopyAudience } = {},
): CopyCheckResult {
  const audience = opts.audience ?? "customer";
  const blocking: CopyViolation[] = [];
  const warnings: CopyViolation[] = [];

  for (const rule of COPY_RULES) {
    if (rule.audiences && !rule.audiences.includes(audience)) continue;
    for (const [excerpt, index] of rule.find(text)) {
      const v: CopyViolation = {
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        excerpt: excerpt.trim(),
        index,
      };
      if (rule.severity === "block") blocking.push(v);
      else warnings.push(v);
    }
  }

  return { pass: blocking.length === 0, blocking, warnings };
}

/** One readable block for a model, or for a decision row. */
export function formatCopyCheck(result: CopyCheckResult): string {
  if (result.pass && result.warnings.length === 0) {
    return "PASS. No copy-rule violations.";
  }
  const lines: string[] = [result.pass ? "PASS with warnings." : "BLOCKED."];
  for (const v of [...result.blocking, ...result.warnings]) {
    lines.push(
      `- [${v.severity}] ${v.rule}: "${v.excerpt}" at ${v.index}. ${v.message}`,
    );
  }
  return lines.join("\n");
}
