import type { PreparedPrice } from "@/lib/services/operators/prepared-pages";

/**
 * The "From" price on a prepared trip: what an adult pays to do the trip's main thing.
 * Operators list it beside lines that are not the trip (watching from the boat while
 * others swim, a child fare, a members' rate, a marine park levy, a lunch add-on), and
 * the cheapest line would make a A$660 whale shark swim read "From A$250".
 *
 * Operators list the trip's own prices first and the extras after, so the list is read
 * only up to the first extra (an optional item, a surcharge, food, a pick-up). Within
 * that, lines that are never the trip's own price are set aside: fees, levies, deposits,
 * minimum spends, optional extras, family and group rates, members' and concession fares,
 * and children's fares. Then, each only when something else is left: packages, meals,
 * watching fares (observer, sightseeing) and self-guided hire. Of what is left, lines
 * marked adult are preferred, and the lowest is the From price. When nothing is left there
 * is no adult price to show, and the From price stays empty.
 */

const NEVER_THE_TRIP = /\blev(y|ies)\b|\bfees?\b|\btax(es)?\b|surcharge|deposit|\bbond\b|\bspend\b|add-?on|optional|\bextras?\b|upgrade|unlimited|catering|drinks|grazing|\bphotos\b|gopro|footage|famil|group (rate|pricing)|\bmembers?\b|concession|pension|senior/i;
const CHILD = /\b(child|children|kids?|junior|infant|baby|toddler)\b/i;
const IN_THE_WATER = /swim|snorkel|dive|diving|scuba/i;
const WATCHING = /sightsee|\bwatch\b/i;
const ADULT = /\badults?\b/i;

/** Where the extras start on an operator's price list. */
const EXTRAS_START = /optional|\bextras?\b|add-?on|surcharge|deposit|\blev(y|ies)\b|\bfees?\b|\bspend\b|upgrade|catering|drinks|grazing|\bfood\b|\bmenu\b|platters?|\bfruit\b|pick ?-?up|transfers?|\bphotos\b|gopro|footage/i;

/** Set aside only when another line is left to be the price, in this order. */
const ONLY_IF_SOMETHING_ELSE: ((label: string) => boolean)[] = [
  (label) => /package/i.test(label),
  (label) => /\b(lunch|dinner|breakfast|feast(ing)?|meals?|platters?|bbq|food|menu|canap[eé]s?|buffet)\b/i.test(label),
  // "Swim & Watch" is a swim; "Swim & Watch Observer" is not.
  (label) => /observer|non[- ]?swim/i.test(label) || (WATCHING.test(label) && !IN_THE_WATER.test(label)),
  (label) => /self[- ]?guided|\bhire\b|rental/i.test(label),
];

export function mainPrice(prices: PreparedPrice[] | undefined | null): PreparedPrice | null {
  const list = prices ?? [];
  const extras = list.findIndex((p, i) => i > 0 && EXTRAS_START.test(p.label));
  let pool = (extras > 0 ? list.slice(0, extras) : list).filter((p) => typeof p.amount === "number" && p.amount > 0 && !NEVER_THE_TRIP.test(p.label) && !CHILD.test(p.label));
  for (const aside of ONLY_IF_SOMETHING_ELSE) {
    const kept = pool.filter((p) => !aside(p.label));
    if (kept.length) pool = kept;
  }
  if (!pool.length) return null;
  const adults = pool.filter((p) => ADULT.test(p.label));
  return (adults.length ? adults : pool).reduce((low, p) => (p.amount < low.amount ? p : low));
}
