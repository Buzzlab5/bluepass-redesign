/**
 * Who gets the next cold email, and handing them to Instantly.
 *
 * Every candidate passes the same gate before anything is sent:
 *   - a real-looking address whose domain takes mail (an MX record), since a list that
 *     bounces burns the sending domains for everyone after it;
 *   - not on the suppression list (unsubscribed, bounced, said no);
 *   - never in a sequence before, and only one person per business domain;
 *   - the rendered first message passes the copy rules.
 *
 * Nothing leaves unless OUTREACH_ENABLED=true and INSTANTLY_API_KEY is set. Otherwise the
 * same code returns what it would have sent, so the batch can be read before it is real.
 */

import { resolveMx } from "node:dns/promises";
import type { OutreachAudience } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { emailSiteUrl } from "@/lib/services/partner/approval-email";
import { loadPreparedPage } from "@/lib/services/operators/prepared-pages";
import { FORMATS, specialtyLabel } from "@/lib/services/onboarding/creator-match";
import { formatCredit } from "@/lib/services/onboarding/credits";
import { addLeads, instantlyConfigured, textToHtml } from "./instantly";
import { CAMPAIGNS, campaignId, type CampaignKey } from "./campaigns";
import { copyProblems, creatorFirstEmail, operatorFirstEmail, type RenderedEmail } from "./copy";

export function outreachLive(env: Record<string, string | undefined> = process.env) {
  return env.OUTREACH_ENABLED === "true" && Boolean(env.INSTANTLY_API_KEY);
}

const AU_SOURCES = new Set(["rezdy-scrape", "fareharbor-scrape", "prepared-page"]);
const AU_STATE = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/;
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|bigpond|bigpond\.net|optusnet|iinet|internode|tpg|westnet|ozemail)\./i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export type Candidate = {
  audience: OutreachAudience;
  campaignKey: CampaignKey;
  email: string;
  name: string;
  operatorLeadId?: string;
  creatorId?: string;
  website: string | null;
  consentBasis: string;
  email1: RenderedEmail;
};

export type Skipped = { name: string; email: string | null; reason: string };

function domainOf(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function hostOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type MxCheck = (domain: string) => Promise<boolean>;

const mxCache = new Map<string, boolean>();
const defaultMx: MxCheck = async (domain) => {
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  const ok = await Promise.race([
    resolveMx(domain).then((r) => r.length > 0).catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  mxCache.set(domain, ok);
  return ok;
};

/** Looks up the mail servers for a batch's domains side by side, so the gate below reads from cache. */
async function warmMx(emails: (string | null)[], mx: MxCheck) {
  if (mx !== defaultMx) return;
  const domains = [...new Set(emails.map((e) => (e ? domainOf(e.trim()) : "")).filter((d) => d && !mxCache.has(d)))];
  for (let i = 0; i < domains.length; i += 12) await Promise.all(domains.slice(i, i + 12).map((d) => defaultMx(d)));
}

/** Addresses and business domains that may not be emailed again by this campaign. */
async function alreadyHandled(audience: OutreachAudience) {
  const [suppressed, enrolled] = await Promise.all([
    prisma.outreachSuppression.findMany({ select: { email: true } }),
    prisma.outreachEnrolment.findMany({ select: { email: true, audience: true } }),
  ]);
  const emails = new Set([...suppressed, ...enrolled].map((r) => r.email.toLowerCase()));
  const domains = new Set(enrolled.filter((e) => e.audience === audience).map((e) => domainOf(e.email)).filter((d) => !FREE_MAIL.test(d)));
  return { emails, domains };
}

async function gate(input: { email: string | null; name: string }, seen: { emails: Set<string>; domains: Set<string> }, mx: MxCheck): Promise<string | null> {
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!EMAIL.test(email)) return "no usable email address";
  if (seen.emails.has(email)) return "already contacted, or asked not to be";
  const domain = domainOf(email);
  if (!FREE_MAIL.test(domain) && seen.domains.has(domain)) return `someone at ${domain} is already in the sequence`;
  if (!(await mx(domain))) return `${domain} does not take email (no MX record)`;
  return null;
}

/**
 * The next Australian operators to email: never contacted, with a page and an address,
 * those with a finished page first because that page is the whole reason to write.
 */
export async function operatorCandidates(limit: number, opts: { mx?: MxCheck; onlyLeadId?: string } = {}) {
  const base = emailSiteUrl();
  const seen = await alreadyHandled("OPERATOR");
  const leads = await prisma.operatorLead.findMany({
    where: { status: "IMPORTED", email: { not: null }, enrolments: { none: {} }, ...(opts.onlyLeadId ? { id: opts.onlyLeadId } : {}) },
    select: { id: true, slug: true, name: true, email: true, region: true, source: true, websiteUrl: true },
    orderBy: { createdAt: "asc" },
  });
  const au = leads.filter((l) => AU_SOURCES.has(l.source) || AU_STATE.test(l.region ?? ""));
  const pages = new Set((await prisma.preparedOperatorPage.findMany({ where: { qcStatus: "approved" }, select: { slug: true } })).map((p) => p.slug));
  au.sort((a, b) => Number(pages.has(b.slug)) - Number(pages.has(a.slug)));
  await warmMx(au.slice(0, limit * 3).map((l) => l.email), opts.mx ?? defaultMx);

  const ready: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const lead of au) {
    if (ready.length >= limit) break;
    const problem = await gate(lead, seen, opts.mx ?? defaultMx);
    if (problem) { skipped.push({ name: lead.name, email: lead.email, reason: problem }); continue; }
    const loaded = pages.has(lead.slug) ? await loadPreparedPage(lead.slug) : null;
    const email1 = operatorFirstEmail({
      name: lead.name,
      pageUrl: `${base}/operators/${lead.slug}`,
      claimUrl: `${base}/operator/claim/start/${lead.slug}`,
      prepared: loaded ? { tripCount: loaded.trips.length, topTrip: loaded.trips[0]?.trip.title ?? null } : null,
    });
    const blocked = copyProblems(email1, "operator");
    if (blocked.length) { skipped.push({ name: lead.name, email: lead.email, reason: `copy rules: ${blocked.join("; ")}` }); continue; }
    const email = lead.email!.trim().toLowerCase();
    seen.emails.add(email);
    if (!FREE_MAIL.test(domainOf(email))) seen.domains.add(domainOf(email));
    const site = hostOf(lead.websiteUrl);
    ready.push({
      audience: "OPERATOR", campaignKey: "operators-au", email, name: lead.name, operatorLeadId: lead.id, website: lead.websiteUrl,
      consentBasis: `Business address held for ${lead.name}${site ? ` (${site})` : ""}, from ${lead.source}; the email is about their own listing.`,
      email1,
    });
  }
  return { ready, skipped };
}

const STATE_NAMES: Record<string, string> = { NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", SA: "South Australia", WA: "Western Australia", TAS: "Tasmania", NT: "the Northern Territory", ACT: "Canberra" };

/** Researched creators who have not joined: each with the address they publish on their own site. */
export async function creatorCandidates(limit: number, opts: { mx?: MxCheck } = {}) {
  const base = emailSiteUrl();
  const seen = await alreadyHandled("CREATOR");
  const creators = await prisma.creator.findMany({
    where: { hidden: false, partnerProfileId: null, contactEmail: { not: null }, enrolments: { none: {} } },
    include: { campaigns: { where: { status: "REQUESTED" }, select: { operatorName: true, creditCents: true } } },
    orderBy: { createdAt: "asc" },
  });
  // A creator an operator already picked is the most worth writing to.
  creators.sort((a, b) => b.campaigns.length - a.campaigns.length);
  await warmMx(creators.slice(0, limit * 3).map((c) => c.contactEmail), opts.mx ?? defaultMx);

  const ready: Candidate[] = [];
  const skipped: Skipped[] = [];
  for (const c of creators) {
    if (ready.length >= limit) break;
    const problem = await gate({ email: c.contactEmail, name: c.name }, seen, opts.mx ?? defaultMx);
    if (problem) { skipped.push({ name: c.name, email: c.contactEmail, reason: problem }); continue; }
    const topics = c.specialties.filter((s) => !FORMATS.has(s)).map(specialtyLabel);
    const picked = c.campaigns.length
      ? { operators: c.campaigns.map((p) => p.operatorName), amount: formatCredit(c.campaigns.reduce((sum, p) => sum + p.creditCents, 0)) }
      : null;
    const email1 = creatorFirstEmail({
      name: c.name, topics,
      area: c.baseTown ?? (c.baseState ? STATE_NAMES[c.baseState] ?? c.baseState : null),
      signupUrl: `${base}/partners/apply`,
      picked,
    });
    const blocked = copyProblems(email1, "partner");
    if (blocked.length) { skipped.push({ name: c.name, email: c.contactEmail, reason: `copy rules: ${blocked.join("; ")}` }); continue; }
    const email = c.contactEmail!.trim().toLowerCase();
    seen.emails.add(email);
    if (!FREE_MAIL.test(domainOf(email))) seen.domains.add(domainOf(email));
    ready.push({
      audience: "CREATOR", campaignKey: "creators-au", email, name: c.name, creatorId: c.id, website: c.website,
      consentBasis: `Business contact for ${c.name} from creator research (${c.sourceUrl ?? c.website ?? "no source recorded"}); the email is about their own work.`,
      email1,
    });
  }
  return { ready, skipped };
}

/** How many of a campaign's people went in today, so a day never goes over its share. */
export async function enrolledToday(campaignKey: CampaignKey, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return prisma.outreachEnrolment.count({ where: { campaignKey, createdAt: { gte: start } } });
}

/**
 * Hands a batch to Instantly and records each person. Returns what happened; in a rehearsal
 * (sending switched off) nothing is written and nothing is sent.
 */
export async function enrol(candidates: Candidate[], opts: { live?: boolean } = {}) {
  const live = opts.live ?? outreachLive();
  if (!candidates.length) return { live, enrolled: 0, notes: [] as string[] };
  if (!live) return { live, enrolled: 0, notes: [`Rehearsal: ${candidates.length} would be sent. Set OUTREACH_ENABLED=true with INSTANTLY_API_KEY to send.`] };
  if (!instantlyConfigured()) return { live, enrolled: 0, notes: ["INSTANTLY_API_KEY is not set."] };

  const notes: string[] = [];
  let enrolled = 0;
  const byCampaign = new Map<CampaignKey, Candidate[]>();
  for (const c of candidates) byCampaign.set(c.campaignKey, [...(byCampaign.get(c.campaignKey) ?? []), c]);

  for (const [key, group] of byCampaign) {
    const id = await campaignId(key);
    if (!id) { notes.push(`No Instantly campaign named "${CAMPAIGNS[key].name}". Run scripts/instantly-setup.ts first.`); continue; }
    const result = await addLeads(id, group.map((c) => ({
      email: c.email,
      company_name: c.name,
      website: c.website,
      custom_variables: { subject: c.email1.subject, body: textToHtml(c.email1.body), ...c.email1.variables },
    })));
    const created = new Map((result.created_leads ?? []).map((l) => [l.email.toLowerCase(), l.id]));
    for (const c of group) {
      const instantlyLeadId = created.get(c.email) ?? null;
      // Instantly skips anyone already in the workspace; they are not ours to record as sent.
      if (!instantlyLeadId) { notes.push(`${c.name}: Instantly skipped ${c.email} (already in the workspace or blocked).`); continue; }
      await prisma.outreachEnrolment.create({
        data: {
          audience: c.audience, campaignKey: key, email: c.email, operatorLeadId: c.operatorLeadId ?? null, creatorId: c.creatorId ?? null,
          status: "ENROLLED", subject: c.email1.subject, body: c.email1.body, consentBasis: c.consentBasis, instantlyLeadId,
        },
      });
      if (c.operatorLeadId) {
        const lead = await prisma.operatorLead.findUnique({ where: { id: c.operatorLeadId }, select: { slug: true } });
        if (lead) {
          await prisma.operatorOutreachEvent.create({
            data: { operatorLeadId: c.operatorLeadId, operatorSlug: lead.slug, type: "outreach.enrolled", message: c.email1.body, metadata: { campaign: key, subject: c.email1.subject } },
          });
        }
      }
      enrolled += 1;
    }
    notes.push(`${CAMPAIGNS[key].name}: ${result.leads_uploaded} added, ${result.duplicated_leads + result.skipped_count} already there, ${result.in_blocklist} blocked, ${result.invalid_email_count} invalid.`);
  }
  return { live, enrolled, notes };
}

/**
 * A first message an agent wrote for one operator, sent through the same gate and the same
 * campaign as everyone else's. Their words replace the template for step one only.
 */
export async function enrolOperatorWithCopy(leadId: string, copy: { subject: string; body: string }) {
  const { ready, skipped } = await operatorCandidates(1, { onlyLeadId: leadId });
  if (!ready.length) return { ok: false as const, reason: skipped[0]?.reason ?? "not an operator who can be emailed now" };
  const candidate = { ...ready[0], email1: { ...ready[0].email1, subject: copy.subject, body: copy.body } };
  const blocked = copyProblems(candidate.email1, "operator");
  if (blocked.length) return { ok: false as const, reason: `copy rules: ${blocked.join("; ")}` };
  const result = await enrol([candidate]);
  return result.enrolled ? { ok: true as const } : { ok: false as const, reason: result.notes.join(" ") || "not enrolled" };
}
