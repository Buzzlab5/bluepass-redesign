/**
 * The prices a prepared page shows: each trip's From price, and the page's lowest one. Shared
 * by the page itself and the printed claim cards, so both say the same thing.
 */

import type { LoadedPage, PreparedTrip } from "@/lib/services/operators/prepared-pages";

type Trip = LoadedPage["trips"][number];

export function money(amount: number, currency: string) {
  const symbol = currency === "AUD" ? "A$" : currency === "USD" ? "US$" : currency === "BBD" ? "BDS$" : `${currency} `;
  return `${symbol}${amount.toLocaleString("en-AU", { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** The trip's From price: Rezdy's live one when it books on Bluepass, otherwise the website's. */
export function priceOf(t: Trip): { amount: number; currency: string; per: string | null } | null {
  if (t.bookable?.priceFrom) return { amount: t.bookable.priceFrom, currency: t.bookable.currency, per: "per guest" };
  const trip = t.trip;
  if (!trip.priceFrom) return null;
  const currency = trip.prices?.find((p) => p.label === trip.priceFromLabel)?.currency ?? trip.prices?.[0]?.currency ?? "AUD";
  return { amount: trip.priceFrom, currency, per: perWhom(trip) };
}

/** "per adult" only when the From price is an adult's fare; a charter's price is for the boat. */
export function perWhom(t: PreparedTrip) {
  const label = t.priceFromLabel ?? "";
  if (/\badults?\b/i.test(label)) return "per adult";
  if (/per (person|guest|head)|\bpp\b/i.test(label)) return "per person";
  return null;
}

/** The cheapest From price across the trips, in the currency most of them use. Also printed on claim cards. */
export function lowestPrice(trips: Trip[]) {
  // A private charter's whole-boat price is not where a traveller starts; it counts only for an
  // operator that runs nothing but charters. With shared trips and none priced, there is no From.
  const isCharter = (t: Trip) => t.trip.kind === "charter" || /\bprivate\b|\bcharters?\b/i.test(t.trip.title);
  const shared = trips.filter((t) => !isCharter(t));
  const prices = (shared.length ? shared : trips).map(priceOf).filter((p): p is NonNullable<ReturnType<typeof priceOf>> => Boolean(p));
  if (!prices.length) return null;
  const counts = new Map<string, number>();
  for (const p of prices) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const low = Math.min(...prices.filter((p) => p.currency === currency).map((p) => p.amount));
  return money(low, currency);
}
