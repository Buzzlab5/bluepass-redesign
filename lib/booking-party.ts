/**
 * How a booking's party is worded in emails and messages. Pure, and kept out of `lib/services/rails`
 * so its tests run with the ordinary suite: that folder's tests empty tables and only run against a
 * local database.
 */

type PartyLines = { rateId?: string; label: string; quantity: number }[];

export function partyLine(b: { lines: PartyLines }) {
  // Taxes and fees a booking system adds are part of the price, not of the party.
  return b.lines
    .filter((l) => l.rateId !== "fees" && !l.rateId?.startsWith("extra:"))
    .map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.label}` : l.label))
    .join(", ");
}

/**
 * The Guests row, saying each thing once. "2 · 2 × Adult" said the same number twice; this reads as one
 * fact: "2 × Adult" when the party is a single kind of ticket, "3 guests · 2 × Adult, Child" when it is
 * mixed, and "6 guests · Private charter" when the price is per booking and so does not count heads.
 */
export function guestsLine(b: { guests: number; lines: PartyLines }): string {
  const people = `${b.guests} ${b.guests === 1 ? "guest" : "guests"}`;
  const tickets = b.lines.filter((l) => l.rateId !== "fees" && !l.rateId?.startsWith("extra:"));

  if (tickets.length === 0 || (tickets.length === 1 && tickets[0].rateId === "manual")) return people;
  if (tickets.length === 1 && tickets[0].quantity === b.guests) return `${b.guests} × ${tickets[0].label}`;
  return `${people} · ${partyLine({ lines: tickets })}`;
}

