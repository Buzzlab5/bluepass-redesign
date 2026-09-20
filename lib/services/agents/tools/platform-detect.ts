/**
 * Booking-platform detection, and what it means for onboarding.
 *
 * Which system an operator already runs decides everything about how they
 * join: a Rezdy operator can be connected and live the same day, a
 * FareHarbor operator waits on a partner approval BluePass does not
 * control, and an operator on nothing at all can only be an Enquire
 * operator until they adopt something.
 *
 * The signal table is ported from scripts/detect_booking_platforms.py, the
 * scan that produced the 646-operator Australian platform survey, so the
 * agent and the spreadsheets agree on what a Rezdy operator is.
 *
 * Deterministic and pure: the same page gives the same verdict every time,
 * and an agent cannot talk itself into calling a WooCommerce site a Rezdy
 * one. The fetch lives in the tool; the judgement lives here.
 */

export type Platform =
  | "Rezdy"
  | "FareHarbor"
  | "Bokun"
  | "Checkfront"
  | "Peek Pro"
  | "TryBooking"
  | "ResPax / Trilogy"
  | "Bookeasy"
  | "Zaui"
  | "Xola"
  | "Ventrata"
  | "Regiondo"
  | "Livn"
  | "Ivvy"
  | "Getmyboat"
  | "Sailo"
  | "Acuity / Squarespace"
  | "Eventbrite / Humanitix"
  | "Ticketing (other)"
  | "Shopify"
  | "WooCommerce"
  | "None detected";

/** Ported verbatim from the Python scan so both agree on the evidence. */
export const PLATFORM_SIGNALS: [Exclude<Platform, "None detected">, string[]][] = [
  ["Rezdy", ["rezdy.com", "rezdy.js", "data-rezdy", "book.rezdy", "rezdywidget", "rezdyconnect"]],
  ["FareHarbor", ["fareharbor.com", "fh-embed", "fhembed", "book.fareharbor", "fareharbor.js", "lightframe"]],
  ["Bokun", ["bokun.io", "widgets.bokun", "bokunwidget", "bokun.com"]],
  ["Checkfront", ["checkfront.com", "checkfront"]],
  ["Peek Pro", ["peekpro", "book.peek.com", "peek.com/widget", "peekapi"]],
  ["TryBooking", ["trybooking.com"]],
  ["ResPax / Trilogy", ["respax", "resvoyage", "trilogy.travel"]],
  ["Bookeasy", ["bookeasy.com"]],
  ["Zaui", ["zaui.com", "zaui.net"]],
  ["Xola", ["xola.com"]],
  ["Ventrata", ["ventrata"]],
  ["Regiondo", ["regiondo"]],
  ["Livn", ["livn.world"]],
  ["Ivvy", ["ivvy.com"]],
  ["Getmyboat", ["getmyboat.com"]],
  ["Sailo", ["sailo.com"]],
  ["Acuity / Squarespace", ["acuityscheduling", "squarespace-scheduling"]],
  ["Eventbrite / Humanitix", ["eventbrite.com", "humanitix.com", "ticketebo"]],
  ["Ticketing (other)", ["oztix", "megatix", "sticky.tickets", "tickettailor"]],
  ["Shopify", ["cdn.shopify.com", "myshopify.com"]],
  ["WooCommerce", ["woocommerce"]],
];

export const BOOK_PATHS = ["", "/book", "/book-now", "/bookings", "/booking", "/tours", "/rates", "/book-online"];

export type PlatformDetection = {
  platform: Platform;
  evidence: string | null;
  /** Every platform found, when a site embeds more than one. */
  all: { platform: Platform; evidence: string }[];
};

export function detectPlatform(html: string): PlatformDetection {
  const h = html.toLowerCase();
  const all: { platform: Platform; evidence: string }[] = [];
  for (const [platform, needles] of PLATFORM_SIGNALS) {
    const hit = needles.find((n) => h.includes(n));
    if (hit) all.push({ platform, evidence: hit });
  }
  // The table is ordered by how tour-native the system is, so the first hit
  // wins: a Rezdy widget on a WooCommerce site is a Rezdy operator.
  if (all.length === 0) return { platform: "None detected", evidence: null, all };
  return { platform: all[0].platform, evidence: all[0].evidence, all };
}

// ─── What the platform means for onboarding ──────────────────────────────────

/**
 * How an operator on this platform can join, under the automatic-only rule.
 *   connect_now   — a live connector exists; they can be bookable today
 *   connect_soon  — the connector is a decided build, not yet shipped
 *   blocked       — reaching them needs an approval BluePass does not control
 *   enquire_only  — no connector path; they onboard through Kai with rails loaded
 */
export type OnboardingPath = "connect_now" | "connect_soon" | "blocked" | "enquire_only";

export type PlatformAssessment = {
  path: OnboardingPath;
  /** 0-100. Ranks the outreach queue; higher goes first. */
  priority: number;
  note: string;
};

const ASSESSMENTS: Record<Platform, PlatformAssessment> = {
  Rezdy: {
    path: "connect_now",
    priority: 100,
    note: "Live connector. They can be connected and bookable the day they claim, with no data entry.",
  },
  Checkfront: {
    path: "connect_now",
    priority: 85,
    note: "Same company as Rezdy since 2023. Confirm the Rezdy agent surface reaches their inventory before promising same-day.",
  },
  "ResPax / Trilogy": {
    path: "connect_soon",
    priority: 70,
    note: "Reachable through one Livn or Cobber integration, which also carries the largest Reef and Whitsundays vessels.",
  },
  Livn: {
    path: "connect_soon",
    priority: 68,
    note: "Aggregator. One integration reaches whatever supply it already carries.",
  },
  FareHarbor: {
    path: "blocked",
    priority: 45,
    note: "The largest single bucket, and gated on a partner approval from a Booking Holdings company that competes with BluePass. Onboard as Enquire now; upgrade if approval lands.",
  },
  Bokun: {
    path: "blocked",
    priority: 30,
    note: "Viator sits in the money path, which breaks the collecting-agent posture and the 5%. Useful only as inbound for an operator already on it.",
  },
  Zaui: { path: "enquire_only", priority: 35, note: "No connector decided. Enquire, with rails loaded at onboarding." },
  Xola: { path: "enquire_only", priority: 35, note: "Self-serve agent construct exists, but volume does not justify a build yet." },
  Ventrata: { path: "enquire_only", priority: 30, note: "No connector decided." },
  Regiondo: { path: "enquire_only", priority: 30, note: "Rezdy's sibling in Europe. Not a decided build." },
  Bookeasy: { path: "enquire_only", priority: 25, note: "Enterprise-gated API and almost no supply. Stays manual permanently." },
  "Peek Pro": { path: "enquire_only", priority: 30, note: "No connector decided." },
  TryBooking: { path: "enquire_only", priority: 25, note: "Event ticketing, not tour-native." },
  Ivvy: { path: "enquire_only", priority: 20, note: "Venue and event software, rarely the booking path for a trip." },
  Getmyboat: { path: "enquire_only", priority: 40, note: "A competing marketplace, not a booking system. Treat the listing as evidence they charter, and pitch the operator direct." },
  Sailo: { path: "enquire_only", priority: 40, note: "As Getmyboat: a marketplace listing, not their own system." },
  "Acuity / Squarespace": { path: "enquire_only", priority: 30, note: "Generic scheduling. Their site is useful as the source for a drafted rate card." },
  "Eventbrite / Humanitix": { path: "enquire_only", priority: 25, note: "Ticketing, not tour inventory." },
  "Ticketing (other)": { path: "enquire_only", priority: 25, note: "Ticketing, not tour inventory." },
  Shopify: { path: "enquire_only", priority: 30, note: "Generic ecommerce. Their storefront is the source for a drafted rate card." },
  WooCommerce: { path: "enquire_only", priority: 30, note: "Generic ecommerce, and the largest of these buckets. Storefront is the draft source." },
  "None detected": {
    path: "enquire_only",
    priority: 20,
    note: "Enquiry, phone or WhatsApp today. They can only be an Enquire operator until they adopt a system BluePass connects to.",
  },
};

export function assessPlatform(platform: Platform): PlatformAssessment {
  return ASSESSMENTS[platform];
}

/**
 * Final queue priority. Platform decides most of it; a warm introduction and
 * a reachable contact decide the rest, because an operator BluePass cannot
 * reach is worth nothing however good their system is.
 */
export function scoreProspect(input: {
  platform: Platform;
  hasEmail?: boolean;
  hasPhone?: boolean;
  warmIntro?: boolean;
  region?: string | null;
}): { priority: number; path: OnboardingPath; reasons: string[] } {
  const base = assessPlatform(input.platform);
  let priority = base.priority;
  const reasons = [`${input.platform}: ${base.note}`];

  if (input.warmIntro) {
    priority += 25;
    reasons.push("Warm introduction available, which converts far better than a cold first touch.");
  }
  if (!input.hasEmail && !input.hasPhone) {
    priority = Math.round(priority * 0.4);
    reasons.push("No email and no phone on file. Unreachable until someone enriches the contact.");
  } else if (!input.hasEmail) {
    priority -= 10;
    reasons.push("No email on file, so the first touch cannot be automated and has to be a person.");
  }

  return { priority: Math.max(0, Math.min(100, priority)), path: base.path, reasons };
}

// ─── Mapping onto this app's PmsPlatform ─────────────────────────────────────

/**
 * This app records only the systems it can actually transact against
 * (PmsPlatform: REZDY, FAREHARBOR, BOKUN, NATIVE). Detection above is
 * deliberately wider, because knowing an operator is on Zaui or on nothing
 * at all is what decides whether they are worth contacting this month. This
 * is the narrowing: everything BluePass cannot connect to is NATIVE, which
 * in this schema means "BluePass carries the inventory", i.e. an Enquire
 * operator.
 */
export type PmsPlatformValue = "REZDY" | "FAREHARBOR" | "BOKUN" | "NATIVE";

export function toPmsPlatform(platform: Platform): PmsPlatformValue {
  switch (platform) {
    case "Rezdy":
    // Checkfront is the same company as Rezdy and is reached through the
    // same agent surface, so it records as REZDY rather than inventing a value.
    case "Checkfront":
      return "REZDY";
    case "FareHarbor":
      return "FAREHARBOR";
    case "Bokun":
      return "BOKUN";
    default:
      return "NATIVE";
  }
}
