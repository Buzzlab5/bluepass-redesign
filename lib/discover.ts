/**
 * Discover page content. Photography is served from /public — the layout is
 * sized for 4:5 (trips) and 4:3 (regions), so `img` fields are cropped to fit.
 *
 * Ningaloo and South Australia have no location photography yet; both fall back
 * to the nearest reef / open-coast frame we hold.
 *
 * `gallery` is a separate case: free Unsplash stock, not our own photography, standing in
 * for a real operator-photo gallery that doesn't exist yet (see the field's own comment).
 *
 * The per-trip editorial (summary, itinerary, departures, operator notes) is
 * placeholder copy written to the right shape and length for the trip sheet —
 * it is not sourced from real operators. Swap it wholesale when the real
 * inventory lands; the sheet reads every field off this file.
 */

/** Shown for a trip whose operator has not uploaded a cover yet, on the trips page and the booking page alike. */
export const FALLBACK_TRIP_IMAGE = "/great-barrier.jpg";

/** The unfiltered region, used as the label when no region is selected. */
export const ALL_REGIONS = "All Australia";

export type Category = "Dive" | "Sail & Yacht" | "Wildlife" | "Expedition";

export const categories: Category[] = ["Dive", "Sail & Yacht", "Wildlife", "Expedition"];

/** Icon glyphs, drawn in the same hairline style as the home-page icons. */
export const categoryIcon: Record<Category, string> = {
  Dive: "M3 15c2-3 4-3 6 0s4 3 6 0 4-3 6 0M12 3v6M9 6l3-3 3 3",
  "Sail & Yacht": "M12 3v13M12 6l6 10H12M10 16H4l3-5M3 20h18",
  Wildlife: "M4 14c3-5 7-7 11-7 3 0 5 1 5 3s-2 4-5 5c-4 1-8 0-11-1zM4 14l-2 5M15 10a1 1 0 1 0 .01 0",
  Expedition: "M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z",
};

export type Region = {
  slug: string;
  name: string;
  img: string;
};

export const regions: Region[] = [
  { slug: "great-barrier-reef", name: "Great Barrier Reef", img: "/great-barrier.jpg" },
  { slug: "whitsundays", name: "Whitsundays", img: "/whitsundays-2.jpg" },
  { slug: "hervey-bay", name: "Hervey Bay", img: "/hervey-bay-2.jpg" },
  { slug: "ningaloo", name: "Ningaloo", img: "/great-barrier-3.jpg" },
  { slug: "sydney-harbour", name: "Sydney Harbour", img: "/sidney.jpg" },
  { slug: "south-australia", name: "South Australia", img: "/gold-coast-2.jpg" },
];

/** One row of the day-by-day shape of a trip. */
export type TripDay = { label: string; title: string; desc: string };

/**
 * How the 5% is divided for this trip, in percent of the contribution. Drives
 * the split bar in the trip sheet; the three names match the home page's
 * Protect / Restore / Uplift language.
 */
export type ImpactSplit = { protect: number; restore: number; uplift: number };

export type Trip = {
  slug: string;
  name: string;
  category: Category;
  region: string;
  /**
   * `rating`/`reviews`/`quote`/`quoteBy` are optional so a real, freshly-synced
   * operator (e.g. from Rezdy) can render honestly with no star rating and no
   * testimonial rather than a fabricated one - see TripGrid/TripSheet, which
   * hide each block when the field is absent instead of showing a fake value.
   * The 6 curated trips below set all of these, so nothing changes for them.
   */
  rating?: number;
  reviews?: number;
  operator: string;
  duration: string;
  detail: string;
  impact: string;
  quote?: string;
  /** Attribution for `quote`, shown in the sheet's pull-quote. */
  quoteBy?: string;
  price: number;
  /** ISO currency of `price`. Unset means AUD, which is what the curated and Rezdy trips are priced in. */
  currency?: string;
  /**
   * Set only for a trip on the native booking rails with a schedule and a price: it can be
   * booked and paid for on the spot, so the sheet offers "Book now" instead of a request.
   */
  bookUrl?: string;
  /** Optional and never fabricated (2026-08-21, Tony's UX audit §9) - there's no real inventory
      system to check remaining spots against, so leave this unset rather than claim a scarcity
      figure nobody can verify. A future real availability integration can set it honestly. */
  scarcity?: string;
  img: string;
  /**
   * Below-the-hero photo strip in the trip sheet. None of these are operator-supplied —
   * there's no real gallery content yet, only 0-4 generic regional stock frames in /public.
   * Free Unsplash photos, picked per trip's theme, stand in so the gallery UI has something
   * honest-looking to demo (2026-08-21, user's explicit call). Swap for real operator photos
   * once they exist; delete the field entirely if that never happens rather than leave stock
   * photography live in production.
   */
  gallery: string[];

  /* ---- sheet-only content ---------------------------------------------- */
  summary: string;
  /** Short "why this one" lines — 4 reads best in the two-column layout. Section hides if empty. */
  highlights: string[];
  /** Day-by-day shape of the trip. Section hides if empty - never fabricate a real itinerary. */
  itinerary: TripDay[];
  includes: string[];
  /** Next open departures. Block hides if empty. */
  departures: string[];
  /** Why this operator is on the platform. Optional - omit rather than invent a claim. */
  operatorNote?: string;
  impactSplit: ImpactSplit;
  /** Named recipient of the 5%, shown against the computed figure. */
  fundsPartner: string;
  /**
   * Set when BluePass resells this trip as a FareHarbor affiliate or Rezdy agent: the traveller
   * books on that platform's own booking page instead of through Kai. Absent means Kai handles it.
   */
  booking?: TripBooking;
};

export type TripBooking = {
  platform: "FAREHARBOR" | "REZDY";
  url: string;
};

const MONEY_PREFIX: Record<string, string> = { AUD: "A$", USD: "US$", EUR: "€", IDR: "Rp " };

/** A trip's price in its own currency. AUD keeps the "A$1,200" look the site was drawn with; other
 *  currencies are named so a Barbados trip in US dollars is never read as Australian dollars. */
export function tripMoney(amount: number, currency?: string): string {
  const code = (currency ?? "AUD").toUpperCase();
  const prefix = MONEY_PREFIX[code] ?? `${code} `;
  return prefix + amount.toLocaleString(code === "AUD" ? "en-AU" : "en-US");
}

export const trips: Trip[] = [
  {
    slug: "ribbon-reefs-run",
    name: "Ribbon Reefs Run",
    category: "Dive",
    region: "Great Barrier Reef",
    operator: "Coral Sea Lines",
    duration: "4 days",
    detail: "14 dives",
    impact: "Grows nursery corals with Reef Restoration Foundation",
    quote: "Cod Hole at 7am with nobody else on the site. The crew ran three dives before lunch.",
    quoteBy: "Tash & Dev, Melbourne",
    price: 2190,
    img: "/great-barrier-5.jpg",
    gallery: [
      "https://images.unsplash.com/photo-1708649290066-5f617003b93f",
      "https://images.unsplash.com/photo-1682687981630-cefe9cd73072",
      "https://images.unsplash.com/photo-1637308109237-4ea1a7dd22f5",
      "https://images.unsplash.com/photo-1682686581663-179efad3cd2f",
    ],
    summary:
      "Four days running the outer ribbons north of Cairns, where the reef wall drops into blue water and the dive sites sit hours from the day-boat fleet. Fourteen dives, small groups, and a crew who plan the day around the tide rather than the timetable.",
    highlights: [
      "Cod Hole and Steve's Bommie before the day boats arrive",
      "Two night dives, both from the back deck",
      "Nitrox included, no surcharge on any dive",
      "Maximum 16 divers with four guides in the water",
    ],
    itinerary: [
      { label: "Day 01", title: "Cairns → outer ribbons", desc: "Afternoon steam out, check dive at dusk, briefing over dinner." },
      { label: "Day 02", title: "Ribbon Reef No. 10", desc: "Four dives including Cod Hole at first light, then a night dive." },
      { label: "Day 03", title: "Steve's Bommie & Pixie Pinnacle", desc: "Four dives on the pinnacles, the deepest water of the trip." },
      { label: "Day 04", title: "Inner reef → Cairns", desc: "Two shallow dives over coral gardens, alongside by mid-afternoon." },
    ],
    includes: ["All 14 dives", "Nitrox fills", "Tanks & weights", "All meals aboard", "Twin-share cabin"],
    departures: ["12 Oct 2026", "26 Oct 2026", "09 Nov 2026"],
    operatorNote:
      "Coral Sea Lines has run the ribbons for 19 years and reports its own reef-health surveys to AIMS after every trip.",
    impactSplit: { protect: 55, restore: 30, uplift: 15 },
    fundsPartner: "Reef Restoration Foundation",
  },
  {
    slug: "humpback-highway",
    name: "Humpback Highway",
    category: "Wildlife",
    region: "Hervey Bay",
    operator: "Hervey Bay Whale Co.",
    duration: "3 days",
    detail: "6 encounters",
    impact: "Funds fluke-ID research along the east-coast migration",
    quote: "Our 8-year-old heard whales sing through the hydrophone for twenty minutes straight.",
    quoteBy: "The Nguyens, Brisbane",
    price: 890,
    img: "/hervey-bay-1.jpg",
    gallery: [
      "https://images.unsplash.com/photo-1568430462989-44163eb1752f",
      "https://images.unsplash.com/photo-1698472505070-6d3b90afb530",
      "https://images.unsplash.com/photo-1520646924857-261be3037bc7",
      "https://images.unsplash.com/photo-1518399681705-1c1a55e5e883",
    ],
    summary:
      "Hervey Bay is the one place on the east-coast migration where humpbacks stop to rest, and mothers bring calves close enough to look you in the eye. Three days in the bay with a research-grade hydrophone aboard and no fixed run sheet.",
    highlights: [
      "Six in-water or alongside encounters across three days",
      "Hydrophone piped through the deck speakers",
      "Fluke-ID photos you take are logged to the research catalogue",
      "Family-rated, the calmest whale water in Australia",
    ],
    itinerary: [
      { label: "Day 01", title: "Platypus Bay", desc: "Slow drift along the western shore where mothers and calves rest." },
      { label: "Day 02", title: "The full bay", desc: "Whichever pods are singing, the skipper follows the hydrophone." },
      { label: "Day 03", title: "Morning run → Urangan", desc: "Dawn encounter, then back to the marina before lunch." },
    ],
    includes: ["All encounters", "Wetsuit & mask hire", "Lunch and morning tea", "Hydrophone sessions", "Marine-biologist guide"],
    departures: ["08 Oct 2026", "22 Oct 2026", "05 Nov 2026"],
    operatorNote:
      "Hervey Bay Whale Co. holds a Level 2 whale-watch permit and has contributed fluke IDs to the east-coast catalogue since 2011.",
    impactSplit: { protect: 45, restore: 20, uplift: 35 },
    fundsPartner: "the east-coast fluke-ID catalogue",
  },
  {
    slug: "whitehaven-under-sail",
    name: "Whitehaven Under Sail",
    category: "Sail & Yacht",
    region: "Whitsundays",
    operator: "Saltline Sailing Co.",
    duration: "3 days",
    detail: "5 anchorages",
    impact: "Funds Tangaroa Blue beach & ghost-net clean-ups",
    quote: "Hill Inlet at the tide turn from the bow, then dinner at anchor with nobody around.",
    quoteBy: "Priya & Sam, Perth",
    price: 1150,
    img: "/whitsundays-3.jpg",
    gallery: [
      "https://images.unsplash.com/photo-1697050891362-17b55eb48346",
      "https://images.unsplash.com/photo-1600085601598-e132cca43e36",
      "https://images.unsplash.com/photo-1696583867312-5b05997a9912",
      "https://images.unsplash.com/photo-1697186030107-441198759d38",
    ],
    summary:
      "Three days under sail through the Whitsunday passage, timed so you reach Hill Inlet on the turning tide and Whitehaven at the hour the day-trippers leave. Five anchorages, no marina nights, and a boat small enough to take the quiet bays.",
    highlights: [
      "Hill Inlet on the tide turn, the sandbanks at their sharpest",
      "Whitehaven Beach after the last day boat has gone",
      "Snorkel stops at Blue Pearl and Manta Ray Bay",
      "Sail her yourself, or don't. The crew is easy either way",
    ],
    itinerary: [
      { label: "Day 01", title: "Airlie Beach → Nara Inlet", desc: "Afternoon sail across the passage, anchor for the night." },
      { label: "Day 02", title: "Whitehaven & Hill Inlet", desc: "Beach landing at low water, lookout walk, snorkel at Blue Pearl." },
      { label: "Day 03", title: "Manta Ray Bay → Airlie", desc: "Morning snorkel, downwind run home under full sail." },
    ],
    includes: ["Skipper & crew", "All meals aboard", "Snorkel gear & stinger suits", "Paddleboards", "Cabin with ensuite"],
    departures: ["15 Oct 2026", "29 Oct 2026", "12 Nov 2026"],
    operatorNote:
      "Saltline runs moorings-only anchoring inside the national park and has never dropped an anchor on coral in eight seasons.",
    impactSplit: { protect: 35, restore: 45, uplift: 20 },
    fundsPartner: "Tangaroa Blue",
  },
  {
    slug: "harbour-nights",
    name: "Harbour Nights",
    category: "Sail & Yacht",
    region: "Sydney Harbour",
    operator: "Harbourline Yachts",
    duration: "1 day",
    detail: "5 hours aboard",
    impact: "Replants harbour seagrass meadows with Operation Posidonia",
    quote: "Client night under the Bridge at golden hour. Not one phone came out all evening.",
    quoteBy: "Marcus L., Sydney",
    price: 395,
    img: "/australia-yacht.jpg",
    gallery: [
      "https://images.unsplash.com/photo-1515482758760-9535c2f0a18c",
      "https://images.unsplash.com/photo-1599352318473-abbc53b44a9a",
      "https://images.unsplash.com/photo-1598948485421-33a1655d3c18",
      "https://images.unsplash.com/photo-1580723843692-137caf37ad17",
    ],
    summary:
      "Five hours on the harbour from late afternoon into dark, out through the heads if the swell allows, back under the Bridge as the city comes on. A working yacht with a chef aboard, not a party boat.",
    highlights: [
      "Boards at Rushcutters Bay, 4pm, golden hour on the water",
      "Chef aboard; menu set the week before with you",
      "Twelve guests maximum, whole-boat charter available",
      "Seagrass restoration briefing from the skipper, if you want it",
    ],
    itinerary: [
      { label: "16:00", title: "Rushcutters Bay", desc: "Board, sail out past Shark Island on the afternoon breeze." },
      { label: "17:30", title: "The heads", desc: "Out to the gap if the swell is kind, canapés on deck." },
      { label: "19:00", title: "Under the Bridge", desc: "Dinner at anchor in Lavender Bay as the lights come up." },
      { label: "21:00", title: "Alongside", desc: "Back at Rushcutters Bay by nine." },
    ],
    includes: ["Five hours aboard", "Chef-prepared dinner", "Australian wine list", "Skipper & deckhand", "Wet-weather gear"],
    departures: ["Daily · Oct 2026", "Daily · Nov 2026", "Daily · Dec 2026"],
    operatorNote:
      "Harbourline runs an all-electric tender and offsets every charter's fuel through Operation Posidonia's seagrass plantings.",
    impactSplit: { protect: 30, restore: 50, uplift: 20 },
    fundsPartner: "Operation Posidonia",
  },
  {
    slug: "whale-shark-interception",
    name: "Whale Shark Interception",
    category: "Wildlife",
    region: "Ningaloo",
    operator: "Ningaloo Drift",
    duration: "5 days",
    detail: "10 swims",
    impact: "Funds ECOCEAN's whale-shark photo-ID library",
    quote: "Three sharks in one morning. The spotter plane radioed in before we'd finished breakfast.",
    quoteBy: "Ellie R., Auckland",
    price: 2450,
    /* The sheet crops its hero to 16:8, which a portrait top-down aerial cannot
       survive — this frame reads as reef at any crop. */
    img: "/reef-conservation1.jpg",
    gallery: [
      "https://images.unsplash.com/photo-1540202404-b2979d19ed37",
      "https://images.unsplash.com/photo-1544552866-49ce864ff896",
      "https://images.unsplash.com/photo-1580580297368-c782fb65d271",
      "https://images.unsplash.com/photo-1618266089457-8cbed84e2e53",
    ],
    summary:
      "Five days on the Ningaloo coast with a spotter plane overhead and a boat that repositions to whatever the pilot finds. Ten in-water swims across the week, plus the fringing reef fifty metres off the beach for everything in between.",
    highlights: [
      "Spotter plane on station every morning of the trip",
      "Ten swims, the operator rebooks you free if the count falls short",
      "Manta cleaning stations most afternoons",
      "Every ID photo goes to the ECOCEAN library under your name",
    ],
    itinerary: [
      { label: "Day 01", title: "Exmouth", desc: "Briefing, fit-out, and an afternoon drift on the fringing reef." },
      { label: "Day 02–04", title: "The interception", desc: "Plane up at dawn; the boat runs to whatever it finds. Two to three swims a day." },
      { label: "Day 05", title: "Manta morning", desc: "Cleaning stations at Coral Bay, then back to Exmouth by four." },
    ],
    includes: ["All ten swims", "Spotter aircraft", "Wetsuit, mask & fins", "All meals and transfers", "Photo library upload"],
    departures: ["05 Oct 2026", "19 Oct 2026", "16 Nov 2026"],
    operatorNote:
      "Ningaloo Drift caps its own season at 40 trips to keep pressure off the aggregation, well below its licensed allowance.",
    impactSplit: { protect: 60, restore: 15, uplift: 25 },
    fundsPartner: "ECOCEAN's whale-shark photo-ID library",
  },
  {
    slug: "neptune-cage-week",
    name: "Neptune Cage Week",
    category: "Expedition",
    region: "South Australia",
    operator: "Southern Water Co.",
    duration: "4 days",
    detail: "9 cage drops",
    impact: "Funds white-shark tagging & research at the Neptunes",
    quote: "A 4.5-metre white circled the bottom cage for an hour. I've never been so still.",
    quoteBy: "Dan H., Adelaide",
    price: 3240,
    img: "/gold-coast-3.jpg",
    gallery: [
      "https://images.unsplash.com/photo-1704694214588-24f4bae4757b",
      "https://images.unsplash.com/photo-1637308111472-fdf4886a2e07",
      "https://images.unsplash.com/photo-1563186627-0d185db94083",
      "https://images.unsplash.com/photo-1548147433-ef30d17bf028",
    ],
    summary:
      "Four days at the Neptune Islands in the only water in Australia where you can meet a white shark. Surface cage and ocean-floor cage, nine drops across the week, and a researcher aboard tagging as you watch.",
    highlights: [
      "Both cages, surface and the 20-metre ocean floor cage",
      "Tagging work runs alongside every drop",
      "No chumming: the sharks come to the sea-lion colony, not to bait",
      "Twelve guests, two dive supervisors, one researcher",
    ],
    itinerary: [
      { label: "Day 01", title: "Port Lincoln → North Neptune", desc: "Overnight steam, briefing and cage checks on the way." },
      { label: "Day 02–03", title: "Nine drops", desc: "Surface cage through the morning, floor cage on the slack tide." },
      { label: "Day 04", title: "Sea-lion colony → Port Lincoln", desc: "Snorkel with the colony, then the run home." },
    ],
    includes: ["All nine cage drops", "Dry suits & hookah gear", "All meals aboard", "Twin cabin", "Port Lincoln transfers"],
    departures: ["03 Nov 2026", "17 Nov 2026", "01 Dec 2026"],
    operatorNote:
      "Southern Water Co. carries a research observer on every departure and publishes its tagging data to the national white-shark database.",
    impactSplit: { protect: 65, restore: 10, uplift: 25 },
    fundsPartner: "white-shark tagging at the Neptunes",
  },
];

export const steps = [
  {
    n: "01",
    title: "Ask once",
    desc: "Tell Kai who's coming and when. One conversation covers every vetted operator on the coast.",
    iconD: "M4 5h16v11H8l-4 4z",
  },
  {
    n: "02",
    title: "Pay the operator's rate",
    desc: "Same price as booking direct, always. Our commission comes from the operator's side, never yours.",
    iconD: "M20 12l-8 8-9-9V4h7zM7 7a1 1 0 1 0 0.01 0",
  },
  {
    n: "03",
    title: "5% works for the ocean",
    desc: "A fixed share of every fare funds verified impact in the exact waters you visit, tracked per booking.",
    iconD: "M3 9c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 15c2-3 4-3 6 0s4 3 6 0 4-3 6 0",
  },
];

export const partners = [
  "Coral Sea Lines",
  "Hervey Bay Whale Co.",
  "Saltline Sailing Co.",
  "Harbourline Yachts",
  "Ningaloo Drift",
  "Southern Water Co.",
  "Reef Restoration Foundation",
  "Tangaroa Blue",
  "Operation Posidonia",
  "ECOCEAN",
];

/**
 * Universal to every trip on the platform - never a per-operator or per-trip claim, so it's safe
 * to show even for a real synced trip with nothing else filled in yet (unlike rating/quote/gear,
 * which stay hidden rather than fabricated - see the Trip type's own comment). Mirrors the live
 * copy in app/terms/page.tsx §6 and the DEFAULT_CANCELLATION_POLICY_TIERS Kai's refund engine
 * actually runs on - ported to prose here since bluepass-redesign has no shared package with Kai
 * to import from (bluepass-redesign's own duplicate of the same tiers lives in
 * lib/services/operator/payout-settings.ts's PLATFORM_DEFAULT_CANCELLATION_TIERS). Keep all three
 * in sync if the tiers ever change. An operator's own published policy overrides this at checkout
 * once they've set one (see components/operator/OperatorCancellationPolicy.tsx) - this is only
 * the platform fallback, which is what every one of the 6 curated trips actually falls back to
 * today, since none of them has a real OperatorProfile row.
 */
export const platformCancellationPolicy =
  "Full refund 14+ days before departure. 50% refund 3–13 days before. No refund within 3 days. If the operator cancels, you get a full refund regardless of timing.";

/** Also universal - real for every booking on the platform, not invented per trip. */
export const standardExclusions = [
  "International & domestic flights",
  "Travel insurance",
  "Gratuities for crew or guides",
];

export const discoverHero = "/whitsundays-1.jpg";

/* Displayed on the hero search bar but not wired to a filter yet - there's no availability API to
   send them to. Real integration would mean checking live Rezdy availability across every operator
   in the catalogue at once (not just the one a traveller is already talking to Kai about), which is
   its own project, tied to the same live-availability work item as the instant-book funnel split
   (Tony's 2026-08-12 UX audit, §2). Kept visible per the user's explicit call (2026-08-21) even
   though they're inert for now. */
export const whenOptions = ["Oct 2026", "Nov 2026", "Dec 2026", "Jan 2027", "Flexible"];
export const guestOptions = ["1 guest", "2 guests", "3 guests", "4 guests", "5+ guests"];
