import type { PartnerCategory } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sendPartnerApprovedEmail } from "@/lib/services/partner/approval-email";
import { partnerCategoryOptions } from "@/lib/partners";
import {
  approveOperatorClaim,
  declineOperatorClaim,
} from "@/lib/services/operators/operator-claim-service";
import {
  approveReferralApplication,
  declineReferralApplication,
} from "@/lib/services/referrals/application-approval";

/* The three things a human currently has to decide on. Kept as a const tuple so
   the server action can validate an incoming form value against it rather than
   trusting whatever string arrives in the POST body. */
export const APPROVAL_KINDS = [
  "operator-claim",
  "partner-application",
  "operator-application",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_DECISIONS = ["approve", "decline"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export function isApprovalKind(value: unknown): value is ApprovalKind {
  return APPROVAL_KINDS.includes(value as ApprovalKind);
}

export function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return APPROVAL_DECISIONS.includes(value as ApprovalDecision);
}

/** One label/value line on a review card. `href` turns the value into a link. */
export type ReviewFact = {
  label: string;
  value: string;
  href?: string;
};

/**
 * A row in the queue, already flattened for display. The page renders
 * `ReviewItem`s and knows nothing about which table each came from — which is
 * what lets a fourth kind of application be added here without touching the UI.
 */
export type ReviewItem = {
  kind: ApprovalKind;
  id: string;
  title: string;
  subtitle: string;
  submittedAt: Date;
  facts: ReviewFact[];
  notes: string | null;
};

export type PendingApprovals = {
  claims: ReviewItem[];
  applications: ReviewItem[];
};

/**
 * Accounts on ops.bluepass.co hold an operator's trips before the operator signs up (a
 * prepared page, or a Rezdy supplier). Nobody can sign in to them, so there is nothing
 * to approve; the real operator arrives through a claim.
 */
const NOT_A_PLACEHOLDER = { NOT: { email: { endsWith: "@ops.bluepass.co" } } };

/** The nav badge's number. Counts only — the queue page does the full fetch. */
export async function countPendingApprovals() {
  const [claims, partners, operators] = await Promise.all([
    prisma.operatorClaim.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.partnerProfile.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.operatorProfile.count({
      where: {
        status: "PENDING_REVIEW",
        account: { operatorClaims: { none: { status: "PENDING_REVIEW" } }, ...NOT_A_PLACEHOLDER },
      },
    }),
  ]);

  return claims + partners + operators;
}

export async function listPendingApprovals(): Promise<PendingApprovals> {
  const [claims, partnerProfiles, operatorProfiles] = await Promise.all([
    prisma.operatorClaim.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { createdAt: "asc" },
      include: { account: { select: { email: true, displayName: true, phone: true } } },
    }),
    prisma.partnerProfile.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { createdAt: "asc" },
      include: { account: { select: { email: true, displayName: true, phone: true } } },
    }),
    prisma.operatorProfile.findMany({
      where: {
        status: "PENDING_REVIEW",
        /* Submitting a claim also upserts that account's OperatorProfile to
           PENDING_REVIEW (operator-claim-service.ts's
           createOperatorClaimForAccount), and approving the claim transitions
           the profile along with it. Listing both would show one business twice
           and let an admin approve the claim while declining the profile behind
           it — two writes that contradict each other. The claim is the richer
           record, so it wins and the profile is filtered out here. */
        account: { operatorClaims: { none: { status: "PENDING_REVIEW" } }, ...NOT_A_PLACEHOLDER },
      },
      orderBy: { createdAt: "asc" },
      include: { account: { select: { email: true, displayName: true, phone: true } } },
    }),
  ]);

  return {
    claims: claims.map((claim) => ({
      kind: "operator-claim" as const,
      id: claim.id,
      title: claim.operatorName,
      subtitle: `Claimed by ${claim.claimantName}`,
      submittedAt: claim.createdAt,
      notes: claim.notes,
      facts: facts([
        ["Claimant", claim.claimantName],
        ["Role", claim.claimantRole],
        ["Email", claim.claimantEmail, mailto(claim.claimantEmail)],
        ["Phone", claim.claimantPhone, tel(claim.claimantPhone)],
        ["Signed in as", claim.account.email, mailto(claim.account.email)],
        ["Operator page", claim.operatorSlug],
        ["Website", claim.websiteUrl, claim.websiteUrl],
        ["Proof", claim.proofUrl, claim.proofUrl],
        [
          "Yachts claimed",
          claim.yachtSlugs.length ? `${claim.yachtSlugs.length} (${claim.yachtSlugs.join(", ")})` : null,
        ],
      ]),
    })),
    applications: [
      ...partnerProfiles.map((profile) => ({
        kind: "partner-application" as const,
        id: profile.id,
        title: profile.handle ?? profile.account.displayName ?? profile.account.email,
        subtitle: "Partner application",
        submittedAt: profile.createdAt,
        notes: profile.notes,
        facts: facts([
          ["Name", profile.account.displayName],
          ["Handle", profile.handle],
          ["Partner type", partnerCategoryLabel(profile.partnerCategory)],
          ["Email", profile.account.email, mailto(profile.account.email)],
          ["Phone", profile.account.phone, tel(profile.account.phone)],
          ["Audience", profile.audienceUrl, profile.audienceUrl],
          ["Instagram", profile.instagramUrl, profile.instagramUrl],
          ["YouTube", profile.youtubeUrl, profile.youtubeUrl],
          ["TikTok", profile.tiktokUrl, profile.tiktokUrl],
        ]),
      })),
      ...operatorProfiles.map((profile) => ({
        kind: "operator-application" as const,
        id: profile.id,
        title: profile.companyName ?? profile.account.displayName ?? profile.account.email,
        subtitle: "Operator application",
        submittedAt: profile.createdAt,
        notes: profile.notes,
        facts: facts([
          ["Company", profile.companyName],
          ["Contact", profile.account.displayName],
          ["Email", profile.account.email, mailto(profile.account.email)],
          ["WhatsApp", profile.whatsappE164, tel(profile.whatsappE164)],
          ["Phone", profile.account.phone, tel(profile.account.phone)],
          ["Website", profile.websiteUrl, profile.websiteUrl],
          ["Country", profile.country],
          ["Operator page", profile.claimedOperatorSlug],
        ]),
      })),
    ].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime()),
  };
}

/**
 * Routes a decision to the service that already implements it.
 *
 * Nothing here reimplements a status transition: `approveOperatorClaim` also
 * provisions the referral partner and syncs the outreach lead,
 * `approveReferralApplication` also provisions the partner and its link. This
 * function exists purely so the server action has one call to make and the
 * dispatch itself is testable without a request context.
 */
export async function resolveApproval(
  input: {
    kind: ApprovalKind;
    id: string;
    decision: ApprovalDecision;
    reviewerEmail: string;
  },
  /* Injectable because the default really emails the applicant: a test approving a seeded
     application must not mail anyone. */
  deps: { notifyPartnerApproved?: (partnerProfileId: string) => Promise<unknown> } = {},
) {
  if (input.kind === "operator-claim") {
    return input.decision === "approve"
      ? approveOperatorClaim({ claimId: input.id, reviewerEmail: input.reviewerEmail })
      : declineOperatorClaim({ claimId: input.id, reviewerEmail: input.reviewerEmail });
  }

  const kind = input.kind === "partner-application" ? "partner" : "operator";

  if (input.decision !== "approve") {
    return declineReferralApplication({ kind, id: input.id });
  }

  // Only a first approval sends the welcome email, so a repeated click never mails twice.
  const wasApproved =
    kind === "partner"
      ? (await prisma.partnerProfile.findUnique({ where: { id: input.id }, select: { status: true } }))?.status === "APPROVED"
      : true;

  const approved = await approveReferralApplication({ kind, id: input.id });

  if (kind === "partner" && !wasApproved) {
    const notify = deps.notifyPartnerApproved ?? sendPartnerApprovedEmail;
    await notify(input.id).catch((error) =>
      console.error("partner_approval.email_failed", {
        partnerProfileId: input.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return approved;
}

type FactRow = [label: string, value: string | null | undefined, href?: string | null];

/** Drops any line whose value is missing, so a card never shows "Phone —". */
function facts(rows: FactRow[]): ReviewFact[] {
  return rows.flatMap(([label, value, href]) =>
    value && value.trim() ? [{ label, value: value.trim(), ...(href ? { href } : {}) }] : [],
  );
}

function mailto(email?: string | null) {
  return email ? `mailto:${email}` : undefined;
}

function tel(phone?: string | null) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined;
}

function partnerCategoryLabel(category: PartnerCategory | null) {
  return category ? (partnerCategoryOptions.find((option) => option.value === category)?.label ?? null) : null;
}
