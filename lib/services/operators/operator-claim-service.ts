import { BluePassAccountRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { stopOutreachQuietly } from "@/lib/services/outreach/stop";
import {
  getClaimableOperator,
  getClaimableOperatorBackHref,
} from "@/lib/services/operators/claimable-operators";
import { normalizeReferralCode } from "@/lib/services/referrals/attribution";

export const operatorClaimSchema = z.object({
  operatorSlug: z.string().trim().min(1).max(120),
  claimantName: z.string().trim().min(2).max(120),
  claimantEmail: z.string().trim().email().max(200),
  claimantPhone: z.string().trim().max(40).optional(),
  claimantRole: z.string().trim().max(120).optional(),
  websiteUrl: z.string().trim().max(300).optional(),
  proofUrl: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  authorized: z.boolean().optional(),
});

export type OperatorClaimInput = z.infer<typeof operatorClaimSchema>;

export async function createOperatorClaimForAccount(
  input: OperatorClaimInput & { accountId: string },
) {
  const operator = await getClaimableOperator(input.operatorSlug);

  if (!operator) {
    throw new Error("Claimable operator was not found.");
  }

  const account = await prisma.bluePassAccount.findUnique({
    where: { id: input.accountId },
    select: { id: true, email: true, roles: true },
  });

  if (!account) {
    throw new Error("BluePass account was not found.");
  }

  const nextRoles = Array.from(
    new Set<BluePassAccountRole>([
      BluePassAccountRole.TRAVELLER,
      ...account.roles,
      BluePassAccountRole.OPERATOR,
    ]),
  );

  await prisma.bluePassAccount.update({
    where: { id: account.id },
    data: { roles: { set: nextRoles } },
    select: { id: true },
  });

  const websiteUrl = normalizeOptionalUrl(input.websiteUrl);
  const proofUrl = normalizeOptionalUrl(input.proofUrl);

  const existingPendingClaim = await prisma.operatorClaim.findFirst({
    where: {
      accountId: account.id,
      operatorSlug: operator.slug,
      status: "PENDING_REVIEW",
    },
    orderBy: { createdAt: "desc" },
  });

  const claimData = {
    operatorSlug: operator.slug,
    operatorName: operator.name,
    yachtSlugs: operator.yachtSlugs,
    accountId: account.id,
    status: "PENDING_REVIEW" as const,
    claimantName: input.claimantName.trim(),
    claimantEmail: input.claimantEmail.trim().toLowerCase(),
    claimantPhone: optionalString(input.claimantPhone),
    claimantRole: optionalString(input.claimantRole),
    websiteUrl,
    proofUrl,
    notes: optionalString(input.notes),
  };

  const claim = existingPendingClaim
    ? await prisma.operatorClaim.update({
        where: { id: existingPendingClaim.id },
        data: claimData,
      })
    : await prisma.operatorClaim.create({
        data: claimData,
      });

  await prisma.operatorProfile.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      status: "PENDING_REVIEW",
      companyName: operator.name,
      whatsappE164: optionalString(input.claimantPhone),
      websiteUrl: websiteUrl ?? operator.websiteUrl,
      claimedOperatorSlug: operator.slug,
      claimedYachtSlugs: operator.yachtSlugs,
      notes: `Claim request ${claim.id} submitted for ${operator.name}.`,
    },
    update: {
      status: "PENDING_REVIEW",
      companyName: operator.name,
      whatsappE164: optionalString(input.claimantPhone),
      websiteUrl: websiteUrl ?? operator.websiteUrl,
      claimedOperatorSlug: operator.slug,
      claimedYachtSlugs: operator.yachtSlugs,
      notes: `Claim request ${claim.id} updated for ${operator.name}.`,
    },
  });
  await syncOperatorLeadClaimStatus({
    operatorSlug: operator.slug,
    status: "CLAIM_SUBMITTED",
    eventType: "CLAIM_SUBMITTED",
    message: `Claim ${claim.id} submitted for ${operator.name}.`,
  });

  return claim;
}

export async function approveOperatorClaim(input: {
  claimId: string;
  reviewerEmail: string;
}) {
  const claim = await prisma.operatorClaim.findUnique({
    where: { id: input.claimId },
    include: {
      account: {
        select: {
          id: true,
          email: true,
          displayName: true,
          phone: true,
        },
      },
    },
  });

  if (!claim) {
    throw new Error("Operator claim was not found.");
  }

  const operator = await getClaimableOperator(claim.operatorSlug);

  if (!operator) {
    throw new Error("Claimable operator was not found.");
  }

  const profile = await prisma.operatorProfile.findUnique({
    where: { accountId: claim.accountId },
    include: { referralPartner: { include: { links: true } } },
  });
  const partner =
    profile?.referralPartner ??
    (await createOperatorReferralPartner({
      operatorName: claim.operatorName,
      email: claim.claimantEmail || claim.account.email,
      phone: claim.claimantPhone ?? claim.account.phone,
      targetPath: getClaimableOperatorBackHref(operator),
    }));
  const approvedAt = new Date();

  const [approvedClaim, operatorProfile] = await Promise.all([
    prisma.operatorClaim.update({
      where: { id: claim.id },
      data: {
        status: "APPROVED",
        reviewedAt: approvedAt,
        reviewedBy: input.reviewerEmail,
      },
    }),
    prisma.operatorProfile.update({
      where: { accountId: claim.accountId },
      data: {
        status: "APPROVED",
        companyName: claim.operatorName,
        whatsappE164: claim.claimantPhone,
        websiteUrl: claim.websiteUrl ?? operator.websiteUrl,
        referralPartnerId: partner.id,
        claimedOperatorSlug: claim.operatorSlug,
        claimedYachtSlugs: claim.yachtSlugs,
        claimedAt: approvedAt,
        notes: `Claim ${claim.id} approved by ${input.reviewerEmail}.`,
      },
    }),
  ]);
  await syncOperatorLeadClaimStatus({
    operatorSlug: claim.operatorSlug,
    status: "APPROVED",
    eventType: "CLAIM_APPROVED",
    message: `Claim ${claim.id} approved by ${input.reviewerEmail}.`,
  });

  return {
    claim: approvedClaim,
    operatorProfile,
    referralPartner: partner,
  };
}

export async function declineOperatorClaim(input: {
  claimId: string;
  reviewerEmail: string;
}) {
  const claim = await prisma.operatorClaim.update({
    where: { id: input.claimId },
    data: {
      status: "DECLINED",
      reviewedAt: new Date(),
      reviewedBy: input.reviewerEmail,
    },
  });
  await syncOperatorLeadClaimStatus({
    operatorSlug: claim.operatorSlug,
    status: "DECLINED",
    eventType: "CLAIM_DECLINED",
    message: `Claim ${claim.id} declined by ${input.reviewerEmail}.`,
  });

  return claim;
}

async function syncOperatorLeadClaimStatus(input: {
  operatorSlug: string;
  status: "CLAIM_SUBMITTED" | "APPROVED" | "DECLINED";
  eventType: "CLAIM_SUBMITTED" | "CLAIM_APPROVED" | "CLAIM_DECLINED";
  message: string;
}) {
  await prisma.operatorLead.updateMany({
    where: { slug: input.operatorSlug },
    data: { status: input.status },
  });
  await prisma.operatorOutreachEvent.create({
    data: {
      operatorSlug: input.operatorSlug,
      type: input.eventType,
      message: input.message,
    },
  });
  // They have answered the only thing the cold emails ask, so the follow-ups stop here.
  if (input.status !== "DECLINED") {
    await stopOutreachQuietly({ operatorSlug: input.operatorSlug }, input.status === "APPROVED" ? "claimed their page" : "submitted a claim");
  }
}

async function createOperatorReferralPartner(input: {
  operatorName: string;
  email?: string | null;
  phone?: string | null;
  targetPath: string;
}) {
  const code = await buildUniqueReferralCode(input.operatorName);

  return prisma.referralPartner.create({
    data: {
      role: "OPERATOR",
      name: input.operatorName,
      handle: input.operatorName,
      email: input.email,
      phone: input.phone,
      links: {
        create: {
          code,
          label: `${input.operatorName} claim link`,
          targetPath: input.targetPath,
        },
      },
    },
    include: { links: true },
  });
}

async function buildUniqueReferralCode(source: string) {
  const slugSource = source
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalizeReferralCode(slugSource) || "operator";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.referralLink.findUnique({
      where: { code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

function normalizeOptionalUrl(value?: string | null) {
  const raw = optionalString(value);

  if (!raw) {
    return null;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw.replace(/^\/+/, "")}`;
}

function optionalString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
