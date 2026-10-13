import { prisma } from "@/lib/db/prisma";
import { normalizeSlug } from "@/lib/services/operators/operator-leads";

/** A slug no other listing has: the title's, then numbered, then stamped. */
export async function uniqueListingSlug(title: string): Promise<string> {
  const base = normalizeSlug(title) || "trip";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.operatorListing.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Names compared the way people write them: case, punctuation and "Pty Ltd" aside. */
export function sameBusinessName(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(pty|ltd|limited|inc|llc|co|company|the|pt|cv)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  if (!a || !b) return false;
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 6 && y.includes(x)) || (y.length >= 6 && x.includes(y));
}

/** "reefrunner.com.au" from a URL, an email address or a bare domain. */
export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  const fromEmail = raw.includes("@") ? raw.split("@").pop() : null;
  let host = fromEmail ?? raw;
  if (!fromEmail) {
    try {
      host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, "");
  return /\./.test(host) ? host : null;
}

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.com.au", "icloud.com", "me.com", "bigpond.com", "bigpond.net.au", "proton.me", "protonmail.com"]);

/** True when two addresses share a business domain. A shared free-mail domain proves nothing. */
export function sameBusinessDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = domainOf(a);
  const y = domainOf(b);
  if (!x || !y || FREE_MAIL.has(x) || FREE_MAIL.has(y)) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}
