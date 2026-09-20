import { prisma } from "@/lib/db/prisma";
import { normalizeSlug } from "@/lib/services/operators/operator-leads";

/**
 * The read side of the three public claim pages.
 *
 * `OperatorLead` is a BD record, not a published profile: it holds the business
 * name, where it operates and the contact details outreach was sent to. The
 * pages below it are the first thing an operator ever sees of Bluepass, and
 * they are reached from a cold message, so this deliberately returns only what
 * is safe to show a stranger who guessed a slug. The email and phone on the
 * lead are contact details we sourced, not details the business published to
 * us, and they never leave this module.
 */

/** Statuses where a lead still has a page worth showing and a claim worth making. */
const CLAIMABLE: readonly string[] = [
  "IMPORTED",
  "CLAIM_LINK_REQUESTED",
  "CONTACTED",
  "IN_DISCUSSION",
  "MANUAL_REVIEW",
];

export type PublicOperatorLead = {
  slug: string;
  name: string;
  category: string | null;
  region: string | null;
  websiteUrl: string | null;
  /** True once somebody has completed the claim, so the page stops inviting one. */
  claimed: boolean;
  /** True when a claim can still be started from this page. */
  claimable: boolean;
  /** Whether we hold an address the claim link could be sent to. */
  hasEmailOnFile: boolean;
};

export async function loadPublicOperatorLead(
  rawSlug: string,
): Promise<PublicOperatorLead | null> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;

  const lead = await prisma.operatorLead.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      category: true,
      region: true,
      websiteUrl: true,
      email: true,
      status: true,
    },
  });

  if (!lead) return null;

  const status = String(lead.status);
  const claimed = status === "CLAIM_SUBMITTED" || status === "APPROVED" || status === "LIVE";

  return {
    slug: lead.slug,
    name: lead.name,
    category: lead.category,
    region: lead.region,
    websiteUrl: lead.websiteUrl,
    claimed,
    claimable: CLAIMABLE.includes(status),
    // The address itself is never returned. The pages only need to know whether
    // asking for a claim link will get anywhere, so that an operator with no
    // address on file is told that plainly instead of pressing a button that
    // quietly does nothing.
    hasEmailOnFile: Boolean(lead.email && lead.email.trim()),
  };
}

/**
 * Masks an address down to something an operator can recognise as theirs
 * without the page disclosing an address to whoever opened the link. Shows the
 * first character and the domain: "i...@example.com".
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "the address we hold";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${local.length > 1 ? "..." : ""}@${domain}`;
}

/** The masked address for a lead, for the "we sent it to" confirmation line. */
export async function maskedClaimEmailFor(rawSlug: string): Promise<string | null> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return null;
  const lead = await prisma.operatorLead.findUnique({
    where: { slug },
    select: { email: true },
  });
  if (!lead?.email?.trim()) return null;
  return maskEmail(lead.email.trim());
}
