/**
 * Which creators suit an operator: the ones who make the kind of content their trips are
 * about, near where they run them. Creators already on Bluepass come first, since an
 * operator's pick reaches them straight away; the rest are ones Bluepass invites for them.
 */

export const SPECIALTIES = [
  "dive", "freedive", "snorkel", "swim-with-wildlife", "whales", "sharks", "manta", "whale-shark", "dolphins",
  "seals-sea-lions", "turtles", "reef", "wrecks", "macro", "kayak", "sail", "surf", "boating", "fishing",
  "marine-science", "conservation", "travel", "family", "adventure", "photo", "video", "writing", "workshops", "hosted-trips",
] as const;

/** What a creator makes rather than what they make it about; it never makes a match on its own. */
export const FORMATS = new Set(["photo", "video", "writing", "workshops", "hosted-trips", "travel"]);

const SPECIALTY_LABEL: Record<string, string> = {
  dive: "diving", freedive: "freediving", snorkel: "snorkelling", "swim-with-wildlife": "wildlife swims", whales: "whales",
  sharks: "sharks", manta: "manta rays", "whale-shark": "whale sharks", dolphins: "dolphins", "seals-sea-lions": "seals and sea lions",
  turtles: "turtles", reef: "reefs", wrecks: "wrecks", macro: "small marine life", kayak: "kayaking", sail: "sailing", surf: "surf",
  boating: "boating", fishing: "fishing", "marine-science": "marine science", conservation: "conservation", family: "family trips",
  adventure: "adventure",
};

// Read from an operator's own trips and summary.
const KEYWORDS: [RegExp, string][] = [
  [/whale ?sharks?/i, "whale-shark"],
  [/\bmantas?\b|manta rays?/i, "manta"],
  [/humpback|\borcas?\b|killer whale|whale watch|\bwhales?\b(?! ?shark)/i, "whales"],
  [/dolphin/i, "dolphins"],
  [/sea ?lions?|\bseals?\b|fur seal/i, "seals-sea-lions"],
  [/(?<!whale )\bsharks?\b|cage div/i, "sharks"],
  [/turtle/i, "turtles"],
  [/\breefs?\b|coral/i, "reef"],
  [/wreck/i, "wrecks"],
  [/nudibranch|sea ?dragon|macro/i, "macro"],
  [/freediv/i, "freedive"],
  [/scuba|\bdiv(e|es|ing)\b|padi|ssi\b/i, "dive"],
  [/snorkel/i, "snorkel"],
  [/swim with|swims? with|in-water/i, "swim-with-wildlife"],
  [/kayak|paddle ?board|\bsup\b/i, "kayak"],
  [/\bsail|yacht|catamaran/i, "sail"],
  [/\bsurf/i, "surf"],
  [/fishing|\bfish charter/i, "fishing"],
  [/conservation|citizen science|research|eco[- ]?(certified|tour)/i, "conservation"],
  [/marine biolog|scientist/i, "marine-science"],
  [/family|kids|children/i, "family"],
  [/expedition|adventure/i, "adventure"],
];

const KIND_TAG: Record<string, string> = {
  dive: "dive", snorkel: "snorkel", swim: "swim-with-wildlife", kayak: "kayak", sail: "sail", cruise: "boating",
  charter: "boating", liveaboard: "dive", course: "dive",
};

export type OperatorForMatch = {
  state: string | null;
  town: string | null;
  category?: string | null;
  summary?: string | null;
  trips: { kind?: string | null; title: string; summary?: string | null }[];
};

export type CreatorForMatch = {
  id: string;
  name: string;
  baseState: string | null;
  baseTown: string | null;
  regions: string[];
  specialties: string[];
  joined: boolean;
};

export type CreatorMatch<C extends CreatorForMatch = CreatorForMatch> = { creator: C; score: number; reasons: string[]; shared: string[] };

/** What an operator's trips are about, as creator specialties. */
export function operatorTags(op: OperatorForMatch): string[] {
  const tags = new Map<string, number>();
  const add = (tag: string, weight = 1) => tags.set(tag, (tags.get(tag) ?? 0) + weight);
  for (const t of op.trips) {
    if (t.kind && KIND_TAG[t.kind]) add(KIND_TAG[t.kind]);
    const text = `${t.title} ${t.summary ?? ""}`;
    for (const [re, tag] of KEYWORDS) if (re.test(text)) add(tag);
  }
  const about = `${op.category ?? ""} ${op.summary ?? ""}`;
  for (const [re, tag] of KEYWORDS) if (re.test(about)) add(tag, 2);
  return [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

function words(text: string | null | undefined) {
  return (text ?? "").toLowerCase().normalize("NFKD").split(/[^a-z']+/).filter((w) => w.length > 3);
}

/** Words that name a kind of place rather than a place: "coast" alone must not tie Montague Island to the Sunshine Coast. */
const GENERIC_PLACE = new Set([
  "coast", "coastal", "island", "islands", "reef", "reefs", "great", "barrier", "port", "bay", "bays", "beach", "beaches",
  "head", "heads", "point", "cape", "river", "harbour", "harbor", "lake", "gulf", "sound", "strait", "waters", "water",
  "ocean", "oceans", "marine", "north", "south", "east", "west", "northern", "southern", "eastern", "western", "central",
  "upper", "lower", "tropical", "temperate", "australia", "australian", "queensland", "victoria", "victorian",
  "tasmania", "tasmanian", "territory", "wales", "new", "region", "national", "park", "yacht", "race", "around",
]);

const BROAD_PLACE = new Set([
  "australia", "australian", "waters", "western", "south", "southern", "north", "northern", "east", "eastern", "west",
  "central", "tropical", "temperate", "territory", "wales", "queensland", "victoria", "tasmania", "coast", "coastal",
]);

/**
 * True when an operator works in the creator's region: the whole name appears in what the
 * operator says about itself, or one of its distinctive words does ("Ningaloo", "Jervis").
 */
function sharesRegion(region: string, opText: string, opWords: Set<string>) {
  const name = region.toLowerCase().trim();
  // A whole state or the country ("Western Australia", "Tasmania") says nothing about where they shoot.
  const broad = words(region).every((w) => BROAD_PLACE.has(w));
  if (!broad && name.length > 3 && opText.includes(name)) return true;
  return words(region).some((w) => !GENERIC_PLACE.has(w) && opWords.has(w));
}

/**
 * The best creators for an operator, joined ones that match first, each with the reasons
 * it matched in plain words. A creator who shares nothing with the operator but the country still
 * appears below every real match, so the list is never short when the directory is not.
 */
export function matchCreators<C extends CreatorForMatch>(op: OperatorForMatch, creators: C[], limit = 20): CreatorMatch<C>[] {
  const tags = operatorTags(op);
  const wanted = new Map(tags.map((tag, i) => [tag, i < 3 ? 3 : 2]));
  const placeText = `${op.town ?? ""} ${op.summary ?? ""}`.toLowerCase().normalize("NFKD");
  const place = new Set(words(placeText));

  const scored = creators.map((creator) => {
    const reasons: string[] = [];
    let score = 0;
    const shared = creator.specialties.filter((s) => !FORMATS.has(s) && wanted.has(s));
    for (const s of shared) score += wanted.get(s)!;
    if (shared.length) reasons.push(`Shoots ${shared.slice(0, 2).map((s) => SPECIALTY_LABEL[s] ?? s).join(" and ")}`);
    if (creator.baseState && op.state && creator.baseState === op.state) {
      score += 4;
      reasons.push(`Based in ${creator.baseTown ? `${creator.baseTown}, ` : ""}${creator.baseState}`);
    } else if (creator.baseState) {
      score += 1;
    }
    const near = creator.regions.find((r) => sharesRegion(r, placeText, place));
    if (near) {
      score += 3;
      reasons.push(`Works around ${near}`);
    } else if (creator.baseTown && sharesRegion(creator.baseTown, placeText, place)) {
      score += 3; // Lives where the operator runs trips; "Based in" already says so.
    }
    return { creator, score, reasons, shared };
  });

  // A joined creator goes first only when they match at all; an unrelated one would push out a good invite.
  const first = (m: CreatorMatch<C>) => Number(m.creator.joined && m.reasons.length > 0);
  return scored
    .sort((a, b) => first(b) - first(a) || b.score - a.score || a.creator.name.localeCompare(b.creator.name))
    .slice(0, limit);
}

export function specialtyLabel(tag: string) {
  return SPECIALTY_LABEL[tag] ?? tag.replace(/-/g, " ");
}
