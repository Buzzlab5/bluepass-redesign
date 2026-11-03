import type { KaiMissingSlot, KaiTravelIntent } from "@/lib/services/kai/types";
import { yachts } from "@/lib/data/yachts";

const destinationPatterns = [
  { destination: "Komodo", patterns: ["komodo islands", "komodo", "labuan bajo"] },
  { destination: "Raja Ampat", patterns: ["raja ampat", "r4", "raja", "misool"] },
] as const;

const unsupportedDestinations = [
  "bali",
  "nusa penida",
  "penida",
  "nusa lembongan",
  "lembongan",
  "lombok",
  "gili islands",
  "gilis",
  "gili",
  "alor",
  "wakatobi",
  "banda sea",
  "ambon",
  "derawan",
  "bunaken",
  "lembeh",
  "flores",
  "sumba",
  "mentawai",
  "cenderawasih bay",
  "maldives",
  "philippines",
  "fiji",
  "great barrier reef",
  "thailand",
  "palau",
  "egypt",
] as const;

const tripTypes = [
  "liveaboard",
  "diving",
  "sailing",
  "cruising",
  "mixed diving/cruising",
  "snorkelling",
  "freediving",
  "surf",
  "sunset tour",
  "boat tour",
  "whale watching",
  "yacht charter",
  "conservation trip",
] as const;

const tripTypeAliases = [
  {
    tripType: "liveaboard",
    patterns: [
      "liveaboard",
      "liveaboards",
      "live aboard",
      "live aboards",
      "liveaborad",
      "liveaboarad",
      "livaboard",
      "livaboards",
    ],
  },
  { tripType: "snorkelling", patterns: ["snorkeling", "snorkelling", "snorkel"] },
  { tripType: "diving", patterns: ["scuba", "dive", "diving"] },
  { tripType: "cruising", patterns: ["cruise", "cruising"] },
  {
    tripType: "mixed diving/cruising",
    patterns: [
      "mix",
      "mixed",
      "both",
      "both diving and cruising",
      "diving and cruising",
    ],
  },
  { tripType: "freediving", patterns: ["freedive", "freediving"] },
  { tripType: "surf", patterns: ["surf", "surfing"] },
] as const;

const interests = [
  { interest: "mantas", patterns: ["manta", "mantas"] },
  { interest: "sharks", patterns: ["shark", "sharks"] },
  { interest: "turtles", patterns: ["turtle", "turtles"] },
  { interest: "coral reefs", patterns: ["coral reef", "coral reefs", "reef", "reefs"] },
  { interest: "muck diving", patterns: ["muck diving", "muck"] },
  { interest: "macro", patterns: ["macro"] },
  { interest: "underwater photography", patterns: ["underwater photography", "photography", "photo"] },
  { interest: "conservation", patterns: ["conservation"] },
  { interest: "remote islands", patterns: ["remote islands", "remote"] },
  { interest: "luxury", patterns: ["luxury", "luxurious"] },
  { interest: "budget", patterns: ["budget", "affordable"] },
  { interest: "family-friendly", patterns: ["family-friendly", "family friendly", "family"] },
  { interest: "beginner-friendly", patterns: ["beginner-friendly", "beginner friendly", "beginners"] },
  { interest: "adventure", patterns: ["adventure"] },
  { interest: "wellness", patterns: ["wellness"] },
] as const;

const certificationPatterns = [
  { certificationLevel: "advanced open water", patterns: ["advanced open water", "aow", "advanced divers"] },
  { certificationLevel: "open water", patterns: ["open water", "ow"] },
  { certificationLevel: "rescue", patterns: ["rescue"] },
  { certificationLevel: "divemaster", patterns: ["divemaster", "dive master"] },
  { certificationLevel: "instructor", patterns: ["instructor"] },
  { certificationLevel: "non-diver", patterns: ["non-diver", "non diver", "nondiver"] },
  { certificationLevel: "beginner", patterns: ["beginner", "beginners"] },
] as const;

const monthAliases = [
  { value: "January", patterns: ["january", "jan"] },
  { value: "February", patterns: ["february", "feb"] },
  { value: "March", patterns: ["march", "mar"] },
  { value: "April", patterns: ["april", "apr"] },
  { value: "May", patterns: ["may"] },
  { value: "June", patterns: ["june", "jun"] },
  { value: "July", patterns: ["july", "jul"] },
  { value: "August", patterns: ["august", "aug"] },
  { value: "September", patterns: ["september", "sep", "sept"] },
  { value: "October", patterns: ["october", "oct"] },
  { value: "November", patterns: ["november", "nov"] },
  { value: "December", patterns: ["december", "dec"] },
] as const;

const numberWords = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
} as const;

export function extractKaiTravelIntent(
  message: string,
  previousIntent: KaiTravelIntent = {},
  options: { lastAskedSlot?: KaiMissingSlot } = {},
): KaiTravelIntent {
  const normalized = normalize(message);
  const nextIntent: KaiTravelIntent = {
    ...previousIntent,
    interests: previousIntent.interests ? [...previousIntent.interests] : undefined,
  };

  const unsupportedDestination = findFirstPattern(normalized, unsupportedDestinations);

  if (unsupportedDestination) {
    nextIntent.unsupportedDestination = titleCase(unsupportedDestination);
  } else {
    const destination = findDestination(normalized);

    if (destination) {
      nextIntent.destination = destination;
      delete nextIntent.unsupportedDestination;
    }
  }

  const tripType = findTripType(normalized);

  if (tripType) {
    nextIntent.tripType = tripType;
  }

  const dateWindow = findDateWindow(message, normalized, options.lastAskedSlot);

  if (dateWindow) {
    nextIntent.dateWindow = dateWindow;
  }

  const guests = findGuestCount(normalized, options.lastAskedSlot);

  if (guests) {
    nextIntent.guests = guests;
  }

  const budget = findBudget(message, normalized);

  if (budget) {
    nextIntent.budget = budget;
  }

  const certificationLevel = findCertification(normalized, options.lastAskedSlot);

  if (certificationLevel) {
    nextIntent.certificationLevel = certificationLevel;
  }

  const selectedYachtSlug = findSelectedYachtSlug(normalized);

  if (selectedYachtSlug) {
    nextIntent.selectedYachtSlug = selectedYachtSlug;
  }

  const travellerEmail = findTravellerEmail(message);

  if (travellerEmail) {
    nextIntent.travellerEmail = travellerEmail;
  }

  const travellerPhone = findTravellerPhone(message, options.lastAskedSlot);

  if (travellerPhone) {
    nextIntent.travellerPhone = travellerPhone;
  }

  const travellerName = findTravellerName(message, normalized, options.lastAskedSlot);

  if (travellerName) {
    nextIntent.travellerName = travellerName;
  }

  const extractedInterests = findInterests(normalized);

  if (extractedInterests.length > 0) {
    nextIntent.interests = unique([...(nextIntent.interests ?? []), ...extractedInterests]);
  }

  if (containsAny(normalized, ["conservation", "reef restoration", "marine protection"])) {
    nextIntent.conservationPreference = "interested";
  }

  nextIntent.missingSlots = computeMissingSlots(nextIntent);

  return stripEmptyArrays(nextIntent);
}

function findDestination(text: string) {
  for (const item of destinationPatterns) {
    if (containsAny(text, item.patterns)) {
      return item.destination;
    }
  }

  return undefined;
}

function findTripType(text: string) {
  for (const item of tripTypes) {
    if (containsPhrase(text, item)) {
      return item;
    }
  }

  for (const alias of tripTypeAliases) {
    if (containsAny(text, alias.patterns)) {
      return alias.tripType;
    }
  }

  return undefined;
}

function findDateWindow(original: string, normalized: string, lastAskedSlot?: KaiMissingSlot) {
  const rangeMatch = original.match(
    /\b\d{1,2}\s*[-–]\s*\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)(?:\s+\d{4})?\b/i,
  );

  if (rangeMatch) {
    return rangeMatch[0].trim();
  }

  const dayMonthMatch = original.match(
    /\b\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?\b/i,
  );

  if (dayMonthMatch) {
    return dayMonthMatch[0].trim();
  }

  const monthYearMatch = original.match(
    /\b(?:in\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
  );

  if (monthYearMatch) {
    return trimLeadingIn(monthYearMatch[0]);
  }

  const relativeMatch = original.match(
    /\b(next\s+(?:week|month|year)|this\s+(?:week|month|year)|tomorrow)\b/i,
  );

  if (relativeMatch) {
    return relativeMatch[1];
  }

  const month = monthAliases.find((candidate) => containsAny(normalized, candidate.patterns));

  if (month) {
    return month.value;
  }

  if (lastAskedSlot === "dateWindow") {
    const shortMonth = monthAliases.find((candidate) =>
      candidate.patterns.some((pattern) => normalized === pattern || normalized === `in ${pattern}`),
    );

    if (shortMonth) {
      return shortMonth.value;
    }
  }

  return undefined;
}

function findGuestCount(text: string, lastAskedSlot?: KaiMissingSlot) {
  const numericMatch = text.match(/\b(\d{1,2})\s*(?:people|person|guests?|travellers?|travelers?|divers?|pax)\b/);

  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const wordWithPeopleMatch = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:people|person|guests?|travellers?|travelers?|divers?|pax)\b/,
  );

  if (wordWithPeopleMatch) {
    return numberWords[wordWithPeopleMatch[1] as keyof typeof numberWords];
  }

  const forNumericMatch = text.match(/\bfor\s+(\d{1,2})\b/);

  if (forNumericMatch) {
    return Number(forNumericMatch[1]);
  }

  const forWordMatch = text.match(
    /\bfor\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/,
  );

  if (forWordMatch) {
    return numberWords[forWordMatch[1] as keyof typeof numberWords];
  }

  const weAreNumericMatch = text.match(/\b(?:we are|there are)\s+(\d{1,2})(?:\s+of us)?\b/);

  if (weAreNumericMatch) {
    return Number(weAreNumericMatch[1]);
  }

  const weAreWordMatch = text.match(
    /\b(?:we are|there are)\s+(one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+of us)?\b/,
  );

  if (weAreWordMatch) {
    return numberWords[weAreWordMatch[1] as keyof typeof numberWords];
  }

  const haveNumericMatch = text.match(
    /\b(?:i have|we have|we'll be|we will be|we are|there will be|party of|group of)\s+(\d{1,2})(?:\s+(?:people|person|guests?|travellers?|travelers?|divers?|pax))?\b/,
  );

  if (haveNumericMatch) {
    return Number(haveNumericMatch[1]);
  }

  const haveWordMatch = text.match(
    /\b(?:i have|we have|we'll be|we will be|we are|there will be|party of|group of)\s+(one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+(?:people|person|guests?|travellers?|travelers?|divers?|pax))?\b/,
  );

  if (haveWordMatch) {
    return numberWords[haveWordMatch[1] as keyof typeof numberWords];
  }

  if (lastAskedSlot === "guests") {
    const bareNumericMatch = text.match(/^\d{1,2}$/);

    if (bareNumericMatch) {
      return Number(bareNumericMatch[0]);
    }

    if (text in numberWords) {
      return numberWords[text as keyof typeof numberWords];
    }
  }

  return undefined;
}

function findBudget(original: string, normalized: string) {
  // Scan every numeric candidate and keep the first one with LOCAL money
  // evidence. The previous single-match version took the first number in the
  // message and then checked currency cues anywhere in the text, so a date
  // like "December 2026" became the budget whenever a "$" appeared later.
  const moneyPattern = /\b(?:under|below|less than|around|about|approx(?:imately)?|budget(?: is)?|up to|max(?:imum)?)?\s*(?:usd\s*)?\$?\s?(\d{1,3}(?:,\d{3})+|\d{3,6}|\d{1,2}(?:\.\d)?k)(?:\s*(?:usd|dollars?|per cabin|per night|night|charter))?\b/gi;
  const moneyCue = /\b(budget|under|below|less than|around|about|approx(?:imately)?|up to|max(?:imum)?|per cabin|per night|charter|night|dollars?)\b/i;

  for (const match of original.matchAll(moneyPattern)) {
    const candidate = match[0];
    const start = match.index ?? 0;
    const localBefore = original.slice(Math.max(0, start - 24), start);
    // The leading word boundary in moneyPattern excludes a "$" directly
    // before the number from the candidate, so currency evidence must also
    // look at the characters immediately before the match.
    const currencyPrefix = /[$]\s*$/.test(localBefore) || /\busd\s*$/i.test(localBefore);

    const hasLocalEvidence =
      candidate.includes("$") ||
      /\busd\b/i.test(candidate) ||
      /\d\s*k\b/i.test(candidate) ||
      moneyCue.test(candidate) ||
      moneyCue.test(localBefore) ||
      currencyPrefix;

    if (!hasLocalEvidence) {
      continue;
    }

    // A year-looking amount (2026) is only a budget when the currency
    // evidence is strong: "$2026" or "2026 dollars" is money; "about 2026"
    // or "budget 2026" is a year.
    const numberPart = (candidate.match(/\d{1,3}(?:,\d{3})+|\d{3,6}|\d{1,2}(?:\.\d)?k/)?.[0] ?? "").replace(/,/g, "");
    const looksLikeYear = /^(?:19|20)\d{2}$/.test(numberPart);

    if (looksLikeYear) {
      const strongCurrency =
        candidate.includes("$") ||
        /\busd\b/i.test(candidate) ||
        /\bdollars?\b/i.test(candidate) ||
        currencyPrefix;

      if (!strongCurrency) {
        continue;
      }
    }

    return candidate.trim();
  }

  if (containsPhrase(normalized, "luxury")) {
    return "luxury";
  }

  if (containsPhrase(normalized, "budget")) {
    return "budget";
  }

  return undefined;
}

function findCertification(text: string, lastAskedSlot?: KaiMissingSlot) {
  if (lastAskedSlot === "certificationLevel" && containsPhrase(text, "advanced")) {
    return "advanced open water";
  }

  for (const item of certificationPatterns) {
    if (containsAny(text, item.patterns)) {
      return item.certificationLevel;
    }
  }

  return undefined;
}

function findSelectedYachtSlug(text: string) {
  for (const yacht of yachts) {
    const names = [yacht.name, yacht.slug.replace(/-/g, " ")].map((value) =>
      value.toLowerCase(),
    );

    if (names.some((name) => containsPhrase(text, name))) {
      return yacht.slug;
    }
  }

  return undefined;
}

function findTravellerEmail(original: string) {
  const match = original.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);

  return match?.[0].trim();
}

function findTravellerPhone(original: string, lastAskedSlot?: KaiMissingSlot) {
  const phoneMatch = original.match(/(?:\+?\d[\d\s().-]{6,}\d)/);

  if (!phoneMatch) {
    return undefined;
  }

  const candidate = phoneMatch[0].trim();
  const digits = candidate.replace(/\D/g, "");

  if (digits.length < 8 || digits.length > 15) {
    return undefined;
  }

  if (lastAskedSlot !== "travellerPhone" && looksLikeDateOrBudget(original, candidate)) {
    return undefined;
  }

  return candidate;
}

function findTravellerName(
  original: string,
  normalized: string,
  lastAskedSlot?: KaiMissingSlot,
) {
  const explicitMatch = original.match(
    /\b(?:my name is|name is|i am|i'm|this is)\s+([A-Za-z][A-Za-z' -]{1,60})(?=,|\.|$|\s+(?:and|email|phone|whatsapp)\b)/i,
  );

  if (explicitMatch) {
    const candidate = cleanTravellerName(explicitMatch[1]);
    const candidateNormalized = normalize(candidate);

    if (
      !looksLikeYachtSelection(normalize(explicitMatch[0])) &&
      !looksLikeYachtSelection(candidateNormalized) &&
      !findSelectedYachtSlug(candidateNormalized)
    ) {
      return candidate;
    }
  }

  if (looksLikeYachtSelection(normalized)) {
    return undefined;
  }

  if (lastAskedSlot === "travellerName") {
    const candidate = original
      .split(/[,;]|\b(?:email|phone|whatsapp)\b/i)[0]
      .trim();

    if (
      /^[A-Za-z][A-Za-z' -]{1,60}$/.test(candidate) &&
      !isConfirmationOnly(candidate) &&
      !containsAny(normalized, tripTypes) &&
      !looksLikeYachtSelection(normalize(candidate))
    ) {
      return cleanTravellerName(candidate);
    }
  }

  return undefined;
}

function cleanTravellerName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isConfirmationOnly(value: string) {
  return /^(?:yes|yeah|yep|sure|ok|okay|please|confirm|confirmed|go ahead)$/i.test(
    value.trim(),
  );
}

function looksLikeYachtSelection(normalized: string) {
  return (
    /\b(?:interested in|i like|i want|choose|select|book|send inquiry|send the inquiry)\b/.test(
      normalized,
    ) && Boolean(findSelectedYachtSlug(normalized))
  );
}

function looksLikeDateOrBudget(original: string, candidate: string) {
  const aroundCandidate = original.slice(
    Math.max(0, original.indexOf(candidate) - 16),
    original.indexOf(candidate) + candidate.length + 16,
  );

  return (
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(aroundCandidate) ||
    /(?:\$|usd|budget|quote|under|below|around|about|per cabin|charter)/i.test(aroundCandidate)
  );
}

function findInterests(text: string) {
  return interests
    .filter((item) => containsAny(text, item.patterns))
    .map((item) => item.interest);
}

function computeMissingSlots(intent: KaiTravelIntent) {
  const missingSlots: string[] = [];

  if (intent.unsupportedDestination) {
    return missingSlots;
  }

  if (!intent.destination) {
    missingSlots.push("destination");
  }

  if (!intent.tripType) {
    missingSlots.push("tripType");
  }

  if (!intent.guests) {
    missingSlots.push("guests");
  }

  if (!intent.dateWindow) {
    missingSlots.push("dateWindow");
  }

  if (!intent.budget) {
    missingSlots.push("budget");
  }

  if (!intent.travellerName) {
    missingSlots.push("travellerName");
  }

  if (!intent.travellerEmail) {
    missingSlots.push("travellerEmail");
  }

  if (!intent.travellerPhone) {
    missingSlots.push("travellerPhone");
  }

  return missingSlots;
}

function findFirstPattern(text: string, patterns: readonly string[]) {
  return patterns.find((pattern) => containsPhrase(text, pattern));
}

function containsAny(text: string, patterns: readonly string[]) {
  return patterns.some((pattern) => containsPhrase(text, pattern));
}

function containsPhrase(text: string, phrase: string) {
  return new RegExp(`(^|\\W)${escapeRegExp(phrase)}($|\\W)`, "i").test(text);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function trimLeadingIn(value: string) {
  return value.replace(/^in\s+/i, "").trim();
}

function titleCase(value: string) {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function stripEmptyArrays(intent: KaiTravelIntent) {
  if (intent.interests?.length === 0) {
    delete intent.interests;
  }

  return intent;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
