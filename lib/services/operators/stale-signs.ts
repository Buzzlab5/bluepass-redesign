import type { PreparedOffer, PreparedTrip } from "@/lib/services/operators/prepared-pages";

/**
 * Facts that have gone out of date since the operator wrote them: departure dates that
 * have passed, price lists for a year that is over, offers that have ended. Operator
 * websites keep these up long after the day, and nobody reading 155 trips by eye will
 * catch every one, so the checking screen is told about them.
 *
 * Dates are read the way operators write them ("24 Oct 2026", "Aug 24th-30th (2026)",
 * "2027: June 6 to 12"): each day and month takes the first year written after it, or
 * failing that the last one before it. A date with no year is left alone.
 */

const MONTH = /^(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(t(ember)?)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Found = { month: number; day: number | null; at: number };

function dayOf(token: string | undefined) {
  const m = token?.match(/^(\d{1,2})(st|nd|rd|th)?$/);
  const day = m ? Number(m[1]) : NaN;
  return day >= 1 && day <= 31 ? day : null;
}

/** Every dated day or month in a piece of text, as the last moment it could mean. */
export function datesIn(text: string): { at: Date; day: boolean }[] {
  const tokens = text.match(/20\d\d|\d{1,2}(?:st|nd|rd|th)?|[A-Za-z]+/g) ?? [];
  const found: Found[] = [];
  const years: { year: number; at: number }[] = [];
  tokens.forEach((token, at) => {
    if (/^20\d\d$/.test(token)) years.push({ year: Number(token), at });
    else if (MONTH.test(token)) found.push({ month: MONTHS.indexOf(token.slice(0, 3)), day: dayOf(tokens[at - 1]) ?? dayOf(tokens[at + 1]), at });
  });
  return found.flatMap(({ month, day, at }) => {
    const year = years.find((y) => y.at > at)?.year ?? [...years].reverse().find((y) => y.at < at)?.year;
    if (!year) return [];
    // A month on its own runs to its last day; a day runs to its end.
    return [{ at: day ? new Date(Date.UTC(year, month, day, 23, 59)) : new Date(Date.UTC(year, month + 1, 0, 23, 59)), day: Boolean(day) }];
  });
}

function quoted(text: string) {
  return `"${text.length > 70 ? `${text.slice(0, 67)}...` : text}"`;
}

function signsIn(text: string | null | undefined, today: Date): string[] {
  if (!text?.trim()) return [];
  const dates = datesIn(text);
  if (dates.length) {
    if (dates.every((d) => d.at < today)) return [`Dates have passed: ${quoted(text)}`];
    // A season still running ("July to October 2026") is not stale; a listed departure day that has gone is.
    if (dates.some((d) => d.day && d.at < today)) return [`Some dates have passed: ${quoted(text)}`];
    return [];
  }
  const years = [...text.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
  if (years.length && Math.max(...years) < today.getUTCFullYear()) return [`Mentions ${Math.max(...years)}: ${quoted(text)}`];
  return [];
}

function offerSigns(offer: PreparedOffer | null | undefined, today: Date) {
  if (!offer) return [];
  if (offer.validUntil && !Number.isNaN(Date.parse(offer.validUntil)) && new Date(offer.validUntil) < today) {
    return [`Offer ended ${offer.validUntil}: ${quoted(offer.text)}`];
  }
  return [offer.text, offer.conditions].flatMap((t) => signsIn(t, today));
}

export function staleSigns(trip: PreparedTrip, today = new Date()): string[] {
  const signs = [
    ...signsIn(trip.title, today),
    ...signsIn(trip.season, today),
    ...(trip.departureTimes ?? []).flatMap((t) => signsIn(t, today)),
    ...(trip.prices ?? []).flatMap((p) => signsIn([p.label, p.note].filter(Boolean).join(", "), today)),
    ...offerSigns(trip.offer, today),
  ];
  return [...new Set(signs)];
}

export function pageStaleSigns(offers: PreparedOffer[] | undefined, today = new Date()): string[] {
  return [...new Set((offers ?? []).flatMap((o) => offerSigns(o, today)))];
}
