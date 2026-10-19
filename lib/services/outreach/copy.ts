/**
 * What the cold emails say. Tony sends them, as himself, so they read like a short note
 * from one person: what we built for you, the one link that matters, what it costs (nothing
 * until a booking), and how to say no. The first message is rendered here per person; the
 * follow-ups live in the Instantly campaign and fill in from the same custom variables.
 *
 * Every message passes the copy rules (checkCopy) before it can be used: no percentage but
 * the 5% to the ocean, no em dashes, no emojis, no price-match promise.
 */

import { checkCopy, type CopyAudience } from "@/lib/services/agents/tools/copy-rules";

export const SIGNATURE = "Tony\nBluepass Pty Ltd · bluepass.co";
const OPT_OUT = "If this isn't for you, reply \"no thanks\" and I won't write again.";

export type OperatorEmailInput = {
  name: string;
  pageUrl: string;
  claimUrl: string;
  /** Set when a prepared page with their trips exists, so the email can point at real work. */
  prepared?: { tripCount: number; topTrip: string | null } | null;
};

export type CreatorEmailInput = {
  name: string;
  topics: string[];
  area: string | null;
  signupUrl: string;
  /** Operators who already picked them, and what is set aside for them. */
  picked?: { operators: string[]; amount: string } | null;
};

export type RenderedEmail = { subject: string; body: string; variables: Record<string, string> };

function listOf(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function operatorFirstEmail(input: OperatorEmailInput): RenderedEmail {
  const greeting = `${input.name} team`;
  const trips = input.prepared && input.prepared.tripCount > 0
    ? `We've built a page for ${input.name} with your ${input.prepared.tripCount === 1 ? "trip" : `${input.prepared.tripCount} trips`}${input.prepared.topTrip ? `, including ${input.prepared.topTrip},` : ""} taken from your own website:`
    : `We've set up a page for ${input.name}:`;
  const claim = input.prepared && input.prepared.tripCount > 0
    ? "Nothing on it is live until you say so. Claim it with one click from the business email we have for you, and change anything you like:"
    : "It only has the basics until you claim it. Claiming takes one click from the business email we have for you, then you add your trips or connect your booking system:";
  const body = [
    `Hi ${greeting},`,
    `I'm Tony and I run Bluepass, a booking site just for ocean trips. ${trips}\n${input.pageUrl}`,
    `${claim}\n${input.claimUrl}`,
    "When you claim it you also get A$100 of credit to have ocean creators near you feature your trips. Listing is free, we only earn when we bring you a booking, and a fixed 5% of every booking goes back to the ocean.",
    OPT_OUT,
    SIGNATURE,
  ].join("\n\n");
  return {
    subject: `A page for ${input.name} on Bluepass`,
    body,
    variables: { greeting, company: input.name, page_url: input.pageUrl, claim_url: input.claimUrl },
  };
}

/** "Dr Vanessa Pirotta" → "Vanessa"; "Nicolas & Lena Remy" → "Nicolas & Lena"; an organisation → null. */
export function creatorFirstName(name: string) {
  const clean = name.replace(/^(dr|prof|professor)\.?\s+/i, "").trim();
  if (/\b(project|foundation|magazine|club|research|photography|media|films?|studios?|collective|society|and high|co\b)/i.test(clean)) return null;
  const pair = clean.match(/^(\S+)\s*(&|and)\s*(\S+)/i);
  if (pair) return `${pair[1]} & ${pair[3]}`;
  return clean.split(/\s+/)[0] || null;
}

export function creatorFirstEmail(input: CreatorEmailInput): RenderedEmail {
  const first = creatorFirstName(input.name);
  const greeting = first ?? "there";
  const topics = input.topics.length ? ` on ${listOf(input.topics.slice(0, 2))}` : "";
  const where = input.area ? ` around ${input.area}` : "";
  const pitch = input.picked?.operators.length
    ? `Operators who join Bluepass get credit to pay creators to feature their trips. ${listOf(input.picked.operators)} ${input.picked.operators.length === 1 ? "has" : "have"} already picked you, with ${input.picked.amount} set aside for you to feature their trips. Join and you can accept from your own page.`
    : "Operators who join Bluepass get credit to pay creators to feature their trips, and they choose from creators near them. I'd like you to be one they can choose.";
  const body = [
    `Hi ${greeting},`,
    `I'm Tony and I run Bluepass, a booking site just for ocean trips in Australia. I came across your work${topics}${where}.`,
    pitch,
    `Joining as a creator is free and takes a couple of minutes:\n${input.signupUrl}`,
    "You also get your own link that earns you a commission on every booking it brings.",
    OPT_OUT,
    SIGNATURE,
  ].join("\n\n");
  return {
    subject: input.area ? `Creators for ocean trips around ${input.area}` : "Creators for ocean trips on Bluepass",
    body,
    variables: { greeting, signup_url: input.signupUrl },
  };
}

/** The follow-ups, written once into the Instantly campaign. {{…}} fills from each lead's variables. */
export const FOLLOW_UPS: Record<"operators" | "creators", { delayDays: number; body: string }[]> = {
  operators: [
    {
      delayDays: 3,
      body: "Hi {{greeting}},\n\nJust bringing this back to the top of your inbox. Your page is here if you'd like to look before you claim it:\n{{page_url}}\n\nTony",
    },
    {
      delayDays: 5,
      body: "Last note from me. If someone else looks after bookings at {{company}}, could you pass this on? The page stays unclaimed until one of you claims it:\n{{claim_url}}\n\nTony",
    },
  ],
  creators: [
    {
      delayDays: 4,
      body: "Hi {{greeting}},\n\nBringing this back up in case it got buried. Operators start picking creators as soon as they join, so it helps to be on the list early:\n{{signup_url}}\n\nTony",
    },
    {
      delayDays: 6,
      body: "Last one from me. If you'd like to be one of the creators ocean operators can pick, it's here:\n{{signup_url}}\n\nEither way, thanks for what you put out about our oceans.\n\nTony",
    },
  ],
};

/** The copy rules on a finished message. A block means it is not sent. */
export function copyProblems(email: { subject: string; body: string }, audience: CopyAudience) {
  const result = checkCopy(`${email.subject}\n\n${email.body}`, { audience });
  return result.blocking.map((v) => `${v.rule}: "${v.excerpt}"`);
}
