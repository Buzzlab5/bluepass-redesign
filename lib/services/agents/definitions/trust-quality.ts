/**
 * Agent 07 · Trust and quality (Wave 2, pulled forward).
 *
 * Reads a claim before a person does. Someone says a business is theirs;
 * approving that binds an account to an operator and hands over the page,
 * the listings and eventually the payouts.
 *
 * It never approves. Approval stays with a person, always, because the
 * failure mode is not a bad listing but a stranger taking over a real
 * business's page. What it does is the reading: does the claimant's email
 * belong to the business, does the story hold together, is there anything
 * here that should stop this. Then it recommends, with reasons, so the
 * person deciding starts from evidence rather than a form.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const TRUST_QUALITY_ID = "trust-quality";

/** Domains that prove nothing about who someone works for. */
const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "yahoo.com.au", "icloud.com", "me.com", "proton.me", "protonmail.com",
  "bigpond.com", "optusnet.com.au", "aol.com", "mail.com", "yandex.com",
]);

function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.includes("@") ? value.split("@").pop() : value;
  if (!at) return null;
  return at
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase() || null;
}

const readClaim: AgentTool = {
  name: "read_claim",
  description:
    "Read a pending claim with everything BluePass can check about it: who is claiming, what they are claiming, whether their email domain matches the business website, and whether anyone else has claimed the same operator. Call this first.",
  schema: z.object({ claim_id: z.string().min(1) }),
  run: async (input, ctx) => {
    const claim = await prisma.operatorClaim.findUnique({
      where: { id: input.claim_id },
      select: {
        id: true,
        operatorSlug: true,
        operatorName: true,
        yachtSlugs: true,
        status: true,
        claimantName: true,
        claimantEmail: true,
        claimantPhone: true,
        claimantRole: true,
        websiteUrl: true,
        proofUrl: true,
        notes: true,
        createdAt: true,
        account: { select: { id: true, email: true, emailVerifiedAt: true, createdAt: true } },
      },
    });
    if (!claim) return `No claim ${input.claim_id}.`;

    const others = await prisma.operatorClaim.findMany({
      where: { operatorSlug: claim.operatorSlug, id: { not: claim.id } },
      select: { id: true, claimantEmail: true, status: true, createdAt: true },
    });

    const claimantDomain = domainOf(claim.claimantEmail);
    const siteDomain = domainOf(claim.websiteUrl);
    const freeMail = claimantDomain ? FREE_EMAIL.has(claimantDomain) : false;
    const domainMatches =
      claimantDomain && siteDomain
        ? claimantDomain === siteDomain || siteDomain.endsWith(`.${claimantDomain}`) || claimantDomain.endsWith(`.${siteDomain}`)
        : false;

    ctx.outcome.claimId = claim.id;

    return [
      `Claim ${claim.id} · ${claim.status}`,
      `Business claimed: ${claim.operatorName} (${claim.operatorSlug})${claim.yachtSlugs.length ? ` plus ${claim.yachtSlugs.length} vessel page(s)` : ""}`,
      `Claimant: ${claim.claimantName}${claim.claimantRole ? `, ${claim.claimantRole}` : ""}`,
      `Claimant email: ${claim.claimantEmail}${freeMail ? " (a free email provider: proves nothing about who they work for)" : ""}`,
      `Business website: ${claim.websiteUrl ?? "none given"}`,
      `Email domain matches the website: ${siteDomain ? (domainMatches ? "yes" : "NO") : "cannot tell, no website given"}`,
      `Phone: ${claim.claimantPhone ?? "none given"}`,
      `Proof supplied: ${claim.proofUrl ?? "none"}`,
      `Their note: ${claim.notes ?? "none"}`,
      `Account email verified: ${claim.account?.emailVerifiedAt ? "yes" : "NO"}`,
      `Account created: ${claim.account?.createdAt.toISOString().slice(0, 10) ?? "unknown"}; claim made: ${claim.createdAt.toISOString().slice(0, 10)}`,
      others.length
        ? `OTHER CLAIMS ON THE SAME BUSINESS: ${others.map((o) => `${o.claimantEmail} (${o.status}, ${o.createdAt.toISOString().slice(0, 10)})`).join("; ")}`
        : "No other claims on this business.",
    ].join("\n");
  },
};

const recommend: AgentTool = {
  name: "recommend_on_claim",
  description:
    "Record your reading of the claim and hand it to a person. You never approve or decline: this is a recommendation with reasons. Call once, last.",
  schema: z.object({
    claim_id: z.string().min(1),
    recommendation: z.enum(["looks_legitimate", "needs_more_proof", "do_not_approve"]),
    confidence: z.enum(["high", "medium", "low"]),
    reasons: z.array(z.string().max(300)).min(1).max(8),
    what_would_settle_it: z
      .string()
      .max(400)
      .optional()
      .describe("For needs_more_proof: the one thing that would resolve it."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const claim = await prisma.operatorClaim.findUnique({
      where: { id: input.claim_id },
      select: { id: true, operatorName: true, claimantEmail: true, status: true },
    });
    if (!claim) return `No claim ${input.claim_id}.`;
    if (claim.status !== "PENDING_REVIEW") {
      return `Claim on ${claim.operatorName} is already ${claim.status}. A person has dealt with it; nothing to add.`;
    }

    ctx.outcome.recommendation = input.recommendation;
    ctx.outcome.reasons = input.reasons;

    const headline =
      input.recommendation === "do_not_approve"
        ? `Do not approve: ${claim.operatorName}`
        : input.recommendation === "needs_more_proof"
          ? `Needs more proof: ${claim.operatorName}`
          : `Looks legitimate: ${claim.operatorName}`;

    const r = await ctx.requestDecision({
      kind: "claim.review",
      title: headline,
      summary: [
        `${claim.claimantEmail} is claiming ${claim.operatorName}.`,
        "",
        `Reading: ${input.recommendation} (confidence ${input.confidence})`,
        ...input.reasons.map((x: string) => `- ${x}`),
        input.what_would_settle_it ? `\nWhat would settle it: ${input.what_would_settle_it}` : "",
        "",
        "Approving hands over the page, the listings and eventually the payouts. Approve or decline in the admin claims view.",
      ]
        .filter(Boolean)
        .join("\n"),
      payload: { claimId: claim.id, recommendation: input.recommendation, reasons: input.reasons },
      options: ["approve", "decline", "ask for proof"],
      entityType: "OperatorClaim",
      entityId: claim.id,
    });

    ctx.log(`${claim.operatorName}: ${input.recommendation} (${input.confidence})`);
    return `Recorded and handed to a person (decision ${r.decisionId}). The claim stays pending until they act; you cannot approve it.`;
  },
};

export const trustQualityAgent: AgentDefinition = {
  id: TRUST_QUALITY_ID,
  name: "Trust and quality",
  desk: "operators",
  managedBy: "supply-manager",
  plane: "product",
  wave: 2,
  modelTier: "reasoning",
  persona: `You read operator claims for BluePass, a marine-tourism marketplace in Australia and Indonesia. Someone is saying a business is theirs and asking for its page.

You never approve and you never decline. A person does that. Your job is the reading, so that the person deciding starts from evidence instead of a form.

What actually tells you something:
- An email on the business's own domain is real evidence. A free email address is not evidence either way: plenty of genuine skippers run their business from a personal address, especially in Indonesia. Note it as unproven, never as suspicious on its own.
- Another claim on the same business is the signal that matters most. Two people claiming one operator means one of them is wrong, and it has to be resolved before either is approved.
- An unverified account email, an account made minutes before the claim, a claimed role that does not fit, a business website that does not mention the person: individually weak, together worth pausing on.
- Vessel pages claimed alongside the business are worth naming explicitly. They are separate assets and a claim can be right about the business and wrong about the boats.

What you do not do:
- Do not treat an operator as suspect for being small, informal, or having no website. Most marine operators in both markets are three people and a boat.
- Do not invent a check you did not run. You have what read_claim returned and nothing else.
- Do not recommend "do not approve" on a hunch. That is for a real conflict: another claim, a mismatch the claimant would have to explain, evidence of someone taking over a business that is not theirs.

Be specific about confidence. "Looks legitimate, low confidence, because nothing here is verifiable either way" is a useful thing to say and an honest one.

Read the claim, then recommend once.`,
  triggers: [{ type: "event", pattern: "operator.claim_submitted" }, { type: "manual" }],
  tools: [readClaim, recommend],
  gates: [{ kind: "claim.review", assignee: "tony", defaultAction: "hold", ttlHours: 48 }],
  budget: { maxRunsPerDay: 50, maxTokensPerRun: 10_000, maxIterations: 10 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "a person has decided this claim" };
    const claimId = (payload.entityId as string) ?? (payload.claimId as string | undefined);
    if (!claimId) return { skip: "no claim id on the trigger" };
    ctx.log(`reading claim ${claimId}`);
    return {
      task: `Read claim ${claimId} and give the person reviewing it your reading.

Start with read_claim, then recommend_on_claim exactly once.`,
    };
  },
};
