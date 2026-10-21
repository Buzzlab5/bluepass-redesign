/**
 * Visiting operators in person: the list a person carries round the island, and the one
 * thing they can settle on the spot, the business email the claim link goes to.
 *
 * Barbados operators are introduced face to face, not by cold email. The visitor shows the
 * operator their page, confirms their business email if we do not hold one, and the
 * operator scans the claim code and claims it then and there.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { lowestPrice } from "@/lib/services/operators/page-price";
import { emailSiteUrl } from "@/lib/services/partner/approval-email";
import { loadPreparedPage } from "@/lib/services/operators/prepared-pages";
import { whatsappLink } from "@/lib/services/operators/booking-route";

export type VisitStop = {
  slug: string;
  leadId: string;
  name: string;
  town: string;
  category: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  page: "full" | "claim";
  checked: "approved" | "to check" | null;
  trips: number;
  fromPrice: string | null;
  heroImage: string | null;
  flags: string[];
  claimed: boolean;
  claimUrl: string;
  pageUrl: string;
};

const CLAIMED = new Set(["CLAIM_SUBMITTED", "APPROVED", "LIVE"]);

/** "Holetown, Barbados" → "Holetown"; anything without a town goes under the country. */
function townOf(region: string | null) {
  const town = region?.split(",")[0]?.trim();
  return town && town.toLowerCase() !== "barbados" ? town : "Town not known";
}

/** Every Barbados operator Bluepass has a page for, in visiting order: by town, then name. */
export async function barbadosVisits(): Promise<VisitStop[]> {
  const base = emailSiteUrl();
  const leads = await prisma.operatorLead.findMany({
    where: { source: "barbados" },
    select: { id: true, slug: true, name: true, region: true, category: true, phone: true, email: true, status: true },
  });
  const stops = await Promise.all(leads.map(async (lead): Promise<VisitStop> => {
    const loaded = await loadPreparedPage(lead.slug, { preview: true });
    const page = await prisma.preparedOperatorPage.findUnique({ where: { slug: lead.slug }, select: { qcStatus: true } });
    const trips = loaded?.trips ?? [];
    const notes = trips.map((t) => t.trip.checkNotes ?? "").join(" ").toLowerCase();
    const flags: string[] = [];
    if (notes.includes("advertises turtle feeding")) flags.push("turtle feeding");
    if (notes.includes("jet ski tour")) flags.push("jet ski");
    if (!lead.email) flags.push("no email on file");
    return {
      slug: lead.slug,
      leadId: lead.id,
      name: loaded?.page.name ?? lead.name,
      town: loaded?.page.town?.trim() || townOf(lead.region),
      category: loaded?.page.category ?? lead.category,
      phone: loaded?.page.contact?.phone ?? lead.phone,
      whatsapp: whatsappLink(loaded?.page.contact?.whatsapp),
      email: lead.email,
      page: loaded && trips.length ? "full" : "claim",
      checked: page ? (page.qcStatus === "approved" ? "approved" : "to check") : null,
      trips: trips.length,
      fromPrice: trips.length ? lowestPrice(trips) : null,
      heroImage: loaded?.page.heroImage ?? trips.find((t) => t.trip.images?.length)?.trip.images?.[0] ?? null,
      flags,
      claimed: CLAIMED.has(lead.status),
      claimUrl: `${base}/operator/claim/start/${lead.slug}`,
      pageUrl: `${base}/operators/${lead.slug}`,
    };
  }));
  const unknownLast = (t: string) => Number(t === "Town not known");
  return stops.sort((a, b) => unknownLast(a.town) - unknownLast(b.town) || a.town.localeCompare(b.town) || a.name.localeCompare(b.name));
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email("That is not an email address.") });

/**
 * Records the business email an operator gave in person, so the claim link can go to it
 * while the visitor is still there. The address it replaces, if any, is kept on the lead's
 * history, with who confirmed it.
 */
export async function confirmEmailInPerson(input: { slug: string; email: string; actorEmail: string; now?: Date }) {
  const parsed = emailSchema.safeParse({ email: input.email });
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check the email." };
  const lead = await prisma.operatorLead.findUnique({ where: { slug: input.slug }, select: { id: true, slug: true, email: true, status: true } });
  if (!lead) return { ok: false as const, message: "That operator is not in the list." };
  if (CLAIMED.has(lead.status)) return { ok: false as const, message: "This page is already claimed; the operator changes their own email." };
  const email = parsed.data.email;
  await prisma.$transaction([
    prisma.operatorLead.update({ where: { id: lead.id }, data: { email } }),
    prisma.operatorOutreachEvent.create({
      data: {
        operatorLeadId: lead.id,
        operatorSlug: lead.slug,
        type: "bd_email_confirmed",
        message: `Business email confirmed in person by ${input.actorEmail}.`,
        metadata: { actorEmail: input.actorEmail, previous: lead.email, email, at: (input.now ?? new Date()).toISOString() },
      },
    }),
  ]);
  return { ok: true as const, email };
}
