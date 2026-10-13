import { randomInt } from "node:crypto";

/**
 * Booking references are read aloud on a phone and copied off a wet manifest, so
 * the alphabet leaves out every character that has a twin: 0/O, 1/I/L, 5/S, 8/B.
 * Six characters from the remaining 27 is a few hundred million codes, enough that
 * a collision is a retry rather than a design problem.
 */
const ALPHABET = "234679ACDEFGHJKMNPQRTUVWXYZ";

export function newBookingReference(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return `BP-${code}`;
}

/** Accepts what a person might type: lower case, no dash, stray spaces. */
export function normaliseReference(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = compact.startsWith("BP") ? compact.slice(2) : compact;
  return `BP-${body}`;
}
