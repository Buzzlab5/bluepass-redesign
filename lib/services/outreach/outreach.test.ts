import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { checkCopy } from "@/lib/services/agents/tools/copy-rules";
import { updateLeadStatus } from "@/lib/services/admin/lead-outreach";
import { autoLinkCreator } from "@/lib/services/onboarding/creator-admin";
import { FOLLOW_UPS, copyProblems, creatorFirstEmail, creatorFirstName, operatorFirstEmail } from "@/lib/services/outreach/copy";
import { creatorCandidates, enrol, operatorCandidates } from "@/lib/services/outreach/enrol";
import { handleInstantlyEvent } from "@/lib/services/outreach/events";
import { setInstantlyFetch } from "@/lib/services/outreach/instantly";
import { stopOutreach } from "@/lib/services/outreach/stop";
import { instantlyDispatcher } from "@/lib/services/outreach/wire";

/**
 * Cold email through Instantly: who is allowed into a sequence, what the first message
 * says, what each Instantly event does to the lead, and that anyone who claims, joins or
 * says no is taken out and never written to again.
 */

const ENV_KEYS = ["OUTREACH_ENABLED", "INSTANTLY_API_KEY", "INSTANTLY_CAMPAIGN_OPERATORS_AU", "INSTANTLY_CAMPAIGN_CREATORS_AU", "OUTREACH_AUTO_REPLY", "OUTREACH_ALERT_EMAILS", "BLUEPASS_ADMIN_EMAILS", "RESEND_API_KEY", "AGENTS_ENABLED", "EMAIL_LINK_BASE_URL", "NEXT_PUBLIC_SITE_URL"];
const saved: Record<string, string | undefined> = {};
const allMail = async () => true;
let calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];

function stubInstantly() {
  calls = [];
  setInstantlyFetch((async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", url: String(url), body });
    if (String(url).endsWith("/leads/add")) {
      const leads = (body?.leads ?? []) as { email: string }[];
      return new Response(JSON.stringify({
        leads_uploaded: leads.length, duplicated_leads: 0, in_blocklist: 0, skipped_count: 0, invalid_email_count: 0,
        created_leads: leads.map((l, index) => ({ index, id: `il-${l.email}`, email: l.email })),
      }));
    }
    return new Response(JSON.stringify({ count: 1, id: "x" }));
  }) as typeof fetch);
}

function goLive() {
  process.env.OUTREACH_ENABLED = "true";
  process.env.INSTANTLY_API_KEY = "test-key";
  process.env.INSTANTLY_CAMPAIGN_OPERATORS_AU = "camp-operators";
  process.env.INSTANTLY_CAMPAIGN_CREATORS_AU = "camp-creators";
}

async function lead(slug: string, more: object = {}) {
  return prisma.operatorLead.create({
    data: { slug, name: slug.replace(/-/g, " "), email: `bookings@${slug}.com.au`, region: "Byron Bay, NSW", source: "fareharbor-scrape", websiteUrl: `https://${slug}.com.au`, ...more },
  });
}

beforeEach(async () => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  await prisma.$executeRawUnsafe(`TRUNCATE "OutreachEvent", "OutreachEnrolment", "OutreachSuppression", "OperatorOutreachEvent", "OperatorLead", "Creator", "CreatorCampaign", "PartnerProfile", "ReferralPartner", "BluePassAccount" CASCADE`);
  stubInstantly();
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  setInstantlyFetch(null);
});

describe("what the emails say", () => {
  it("writes an operator a short note with their page and claim link, inside the copy rules", () => {
    const prepared = operatorFirstEmail({ name: "Cape Byron Kayaks", pageUrl: "https://bluepass.co/operators/cape-byron-kayaks", claimUrl: "https://bluepass.co/operator/claim/start/cape-byron-kayaks", prepared: { tripCount: 3, topTrip: "Dolphin Kayak Tour" } });
    expect(prepared.body).toContain("your 3 trips, including Dolphin Kayak Tour,");
    expect(prepared.body).toContain("https://bluepass.co/operator/claim/start/cape-byron-kayaks");
    expect(prepared.body).toContain("reply \"no thanks\"");
    expect(copyProblems(prepared, "operator")).toEqual([]);
    const thin = operatorFirstEmail({ name: "Ozsail", pageUrl: "https://bluepass.co/operators/ozsail", claimUrl: "https://bluepass.co/operator/claim/start/ozsail" });
    expect(thin.body).toContain("only has the basics until you claim it");
    expect(copyProblems(thin, "operator")).toEqual([]);
    expect(`${prepared.body}${thin.body}`).not.toMatch(/—|\d+%(?<!5%)/);
  });

  it("writes a creator by first name, with the operators who already picked them", () => {
    expect(creatorFirstName("Dr Vanessa Pirotta")).toBe("Vanessa");
    expect(creatorFirstName("Nicolas & Lena Remy")).toBe("Nicolas & Lena");
    expect(creatorFirstName("Humpbacks and High-rises")).toBeNull();
    expect(creatorFirstName("The Oceania Project")).toBeNull();
    const email = creatorFirstEmail({ name: "Brooke Pyke", topics: ["whale sharks", "turtles"], area: "Exmouth", signupUrl: "https://bluepass.co/partners/apply", picked: { operators: ["Ningaloo Discovery"], amount: "A$33.34" } });
    expect(email.body).toMatch(/^Hi Brooke,/);
    expect(email.body).toContain("your work on whale sharks and turtles around Exmouth");
    expect(email.body).toContain("Ningaloo Discovery has already picked you, with A$33.34 set aside");
    expect(email.body).toContain("Join and you can accept from your own page.");
    expect(email.body).not.toContain("one they can choose");
    expect(copyProblems(email, "partner")).toEqual([]);
  });

  it("keeps every follow-up inside the copy rules", () => {
    for (const step of [...FOLLOW_UPS.operators, ...FOLLOW_UPS.creators]) {
      expect(checkCopy(step.body, { audience: "operator" }).pass).toBe(true);
    }
  });
});

describe("who gets the next email", () => {
  it("takes Australian operators never contacted, one per business, and skips what would bounce or was refused", async () => {
    await lead("cape-byron-kayaks");
    await lead("cape-byron-kayaks-two", { email: "info@cape-byron-kayaks.com.au" });
    await lead("dead-domain", { email: "hello@nowhere-at-all.com.au" });
    await lead("said-no");
    await lead("bali-dive", { source: "csv", region: "Bali" });
    await lead("already-talking", { status: "IN_DISCUSSION" });
    await prisma.outreachSuppression.create({ data: { email: "bookings@said-no.com.au", reason: "replied no", source: "instantly" } });

    const mx = async (domain: string) => domain !== "nowhere-at-all.com.au";
    const { ready, skipped } = await operatorCandidates(10, { mx });
    expect(ready.map((c) => c.name)).toEqual(["cape byron kayaks"]);
    expect(ready[0].email1.body).toContain("/operator/claim/start/cape-byron-kayaks");
    expect(ready[0].consentBasis).toContain("cape-byron-kayaks.com.au");
    expect(skipped.map((s) => s.reason)).toEqual(expect.arrayContaining([
      "someone at cape-byron-kayaks.com.au is already in the sequence",
      "nowhere-at-all.com.au does not take email (no MX record)",
      "already contacted, or asked not to be",
    ]));
  });

  it("puts creators an operator picked first, and skips anyone who already joined", async () => {
    await prisma.creator.create({ data: { slug: "unpicked", name: "Una Picked", source: "research", contactEmail: "una@unpicked.com", baseState: "QLD", specialties: ["reef"] } });
    const picked = await prisma.creator.create({ data: { slug: "picked", name: "Pia Picked", source: "research", contactEmail: "pia@picked.com", baseTown: "Exmouth", specialties: ["whale-shark"] } });
    await prisma.creatorCampaign.create({ data: { operatorAccountId: (await prisma.bluePassAccount.create({ data: { email: "op@x.test", passwordHash: "x" } })).id, operatorName: "Ningaloo Discovery", creatorId: picked.id, status: "REQUESTED", creditCents: 3334, currency: "AUD" } });
    const { ready } = await creatorCandidates(5, { mx: allMail });
    expect(ready.map((c) => c.name)).toEqual(["Pia Picked", "Una Picked"]);
    expect(ready[0].email1.body).toContain("Ningaloo Discovery has already picked you, with A$33.34 set aside");
  });
});

describe("handing a batch to Instantly", () => {
  it("rehearses without sending or recording anything while sending is off", async () => {
    await lead("cape-byron-kayaks");
    const { ready } = await operatorCandidates(5, { mx: allMail });
    const result = await enrol(ready);
    expect(result).toMatchObject({ live: false, enrolled: 0 });
    expect(calls).toHaveLength(0);
    expect(await prisma.outreachEnrolment.count()).toBe(0);
  });

  it("adds each person to the campaign with their own first message, and records it on the lead", async () => {
    goLive();
    const l = await lead("cape-byron-kayaks");
    const { ready } = await operatorCandidates(5, { mx: allMail });
    expect(await enrol(ready)).toMatchObject({ live: true, enrolled: 1 });
    const sent = calls.find((c) => c.url.endsWith("/leads/add"))!;
    expect(sent.body).toMatchObject({ campaign_id: "camp-operators", skip_if_in_workspace: true });
    const vars = (sent.body!.leads as { custom_variables: Record<string, string> }[])[0].custom_variables;
    expect(vars.subject).toBe("A page for cape byron kayaks on Bluepass");
    expect(vars.body).toContain("<br/><br/>");
    expect(vars.claim_url).toContain("/operator/claim/start/cape-byron-kayaks");
    const enrolment = await prisma.outreachEnrolment.findFirstOrThrow({ where: { operatorLeadId: l.id } });
    expect(enrolment).toMatchObject({ status: "ENROLLED", instantlyLeadId: "il-bookings@cape-byron-kayaks.com.au", campaignKey: "operators-au" });
    expect(await prisma.operatorOutreachEvent.count({ where: { operatorLeadId: l.id, type: "outreach.enrolled" } })).toBe(1);
    // Nobody goes in twice.
    expect((await operatorCandidates(5, { mx: allMail })).ready).toHaveLength(0);
  });
});

describe("what Instantly reports back", () => {
  async function enrolled(slug = "cape-byron-kayaks") {
    goLive();
    const l = await lead(slug);
    await enrol((await operatorCandidates(1, { mx: allMail })).ready);
    return { lead: l, email: l.email! };
  }

  it("marks the lead contacted when the first email goes, once however often it is delivered", async () => {
    const { lead: l, email } = await enrolled();
    const sent = { event_type: "email_sent", lead_email: email, campaign_id: "camp-operators", timestamp: "2026-10-20T00:00:00Z", step: 1, email_id: "e1" };
    expect(await handleInstantlyEvent(sent)).toMatchObject({ duplicate: false });
    expect(await handleInstantlyEvent(sent)).toMatchObject({ duplicate: true });
    expect(await prisma.operatorLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: "CONTACTED" });
    expect(await prisma.operatorOutreachEvent.count({ where: { operatorLeadId: l.id, type: "outreach.email_sent" } })).toBe(1);
  });

  it("honours a plain no on the spot and never writes again", async () => {
    const { lead: l, email } = await enrolled();
    const res = await handleInstantlyEvent({ event_type: "reply_received", lead_email: email, campaign_id: "camp-operators", reply_text: "No thanks, we're all set.", timestamp: "t1", email_id: "r1" });
    expect(res).toMatchObject({ needsPerson: false });
    expect(await prisma.outreachSuppression.findUnique({ where: { email } })).toMatchObject({ reason: "replied no" });
    expect(await prisma.operatorLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: "DECLINED" });
    expect(await prisma.outreachEnrolment.findFirstOrThrow({ where: { email } })).toMatchObject({ status: "NOT_INTERESTED" });
  });

  it("puts a real reply in front of a person and moves the lead to In discussion", async () => {
    const { lead: l, email } = await enrolled();
    const res = await handleInstantlyEvent({ event_type: "reply_received", lead_email: email, campaign_id: "camp-operators", reply_text: "How does the A$100 credit work?", timestamp: "t2", email_id: "r2", email_account: "tony@trybluepass.com", unibox_url: "https://app.instantly.ai/unibox/1" });
    expect(res).toMatchObject({ needsPerson: true });
    expect(await prisma.operatorLead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: "IN_DISCUSSION" });
    expect(await prisma.outreachEnrolment.findFirstOrThrow({ where: { email } })).toMatchObject({ status: "REPLIED" });
  });

  it("never tries a bounced address twice", async () => {
    const { email } = await enrolled();
    await handleInstantlyEvent({ event_type: "email_bounced", lead_email: email, campaign_id: "camp-operators", timestamp: "t3" });
    expect(await prisma.outreachSuppression.findUnique({ where: { email } })).toMatchObject({ reason: "bounced" });
    await lead("other-business", { email });
    expect((await operatorCandidates(5, { mx: allMail })).ready.map((c) => c.email)).not.toContain(email);
  });

  it("drafts an agent's answer for a person instead of sending it from Tony's inbox", async () => {
    const { lead: l, email } = await enrolled();
    await handleInstantlyEvent({ event_type: "reply_received", lead_email: email, campaign_id: "camp-operators", reply_text: "Do you charge a sign-up fee?", timestamp: "t4", email_id: "r4", email_account: "tony@trybluepass.com" });
    const result = await instantlyDispatcher({ channel: "email", to: email, body: "No sign-up fee. Listing is free and we only earn when we bring you a booking.", reference: `lead:${l.id}` });
    expect(result.status).toBe("prepared");
    expect(calls.some((c) => c.url.endsWith("/emails/reply"))).toBe(false);
    const event = await prisma.outreachEvent.findFirstOrThrow({ where: { type: "reply_received", email } });
    expect(event).toMatchObject({ needsPerson: true });
    expect((event.payload as { draft?: { body: string } }).draft?.body).toContain("No sign-up fee");
  });
});

describe("taking people out when something happens on Bluepass", () => {
  it("stops the sequence when the operator claims, and removes them from the Instantly campaign", async () => {
    goLive();
    const l = await lead("cape-byron-kayaks");
    await enrol((await operatorCandidates(1, { mx: allMail })).ready);
    expect(await stopOutreach({ operatorSlug: l.slug }, "claimed their page")).toEqual({ stopped: 1 });
    const removed = calls.find((c) => c.method === "DELETE");
    expect(removed?.body).toEqual({ campaign_id: "camp-operators", ids: ["il-bookings@cape-byron-kayaks.com.au"] });
    expect(await prisma.outreachEnrolment.findFirstOrThrow({ where: { operatorLeadId: l.id } })).toMatchObject({ status: "STOPPED", stopReason: "claimed their page" });
  });

  it("stops when a person takes the lead over in the CRM, and a Declined lead is never emailed again", async () => {
    goLive();
    const l = await lead("cape-byron-kayaks");
    await enrol((await operatorCandidates(1, { mx: allMail })).ready);
    await updateLeadStatus({ leadId: l.id, status: "DECLINED", actorEmail: "tony@arcdojo.com" });
    expect(await prisma.outreachEnrolment.findFirstOrThrow({ where: { operatorLeadId: l.id } })).toMatchObject({ status: "STOPPED" });
    expect(await prisma.outreachSuppression.findUnique({ where: { email: l.email! } })).toMatchObject({ source: "crm" });
  });

  it("links a creator who joins with the Instagram account from their site, and stops their invites", async () => {
    goLive();
    const creator = await prisma.creator.create({ data: { slug: "reef-shooter", name: "Rae Shooter", source: "research", instagram: "reefshooter", contactEmail: "rae@reefshooter.com", baseState: "QLD" } });
    await enrol((await creatorCandidates(1, { mx: allMail })).ready);
    const account = await prisma.bluePassAccount.create({ data: { email: "rae.personal@gmail.com", passwordHash: "x", roles: ["PARTNER"] } });
    const partner = await prisma.referralPartner.create({ data: { role: "PARTNER", name: "Rae", email: account.email } });
    const profile = await prisma.partnerProfile.create({ data: { accountId: account.id, referralPartnerId: partner.id, status: "APPROVED", partnerCategory: "CREATOR", instagramUrl: "https://www.instagram.com/ReefShooter/" } });
    expect(await autoLinkCreator(profile.id)).toMatchObject({ linked: true, creatorId: creator.id });
    expect(await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } })).toMatchObject({ partnerProfileId: profile.id });
    expect(await prisma.outreachEnrolment.findFirstOrThrow({ where: { creatorId: creator.id } })).toMatchObject({ status: "STOPPED", stopReason: "joined Bluepass as a creator" });
  });
});
