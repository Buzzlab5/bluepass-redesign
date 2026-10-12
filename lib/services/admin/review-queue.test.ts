import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { listPendingApprovals, resolveApproval } from "./review-queue";

/**
 * Real rows against the shared dev database, same as rezdy-agent-sync.test.ts. Approving a claim or
 * an application has side effects beyond a status column — it provisions a ReferralPartner and a live
 * ReferralLink, and it writes an OperatorOutreachEvent — so cleanup has to reach all of them. A
 * leftover ReferralLink here would be a working referral code on the real site.
 */
const EMAIL_PREFIX = "admin-review-test+";
const NAME_PREFIX = "Admin Review Test";
const SLUG_PREFIX = "admin-review-test-";
const REVIEWER = "admin-review-test-reviewer@bluepass.co";

afterAll(async () => {
  const accounts = await prisma.bluePassAccount.findMany({
    where: { email: { startsWith: EMAIL_PREFIX } },
    select: { id: true },
  });
  // Cascades to PartnerProfile / OperatorProfile / OperatorClaim.
  await prisma.bluePassAccount.deleteMany({ where: { id: { in: accounts.map((a) => a.id) } } });
  // OperatorProfile.referralPartnerId is SetNull, so partners outlive the cascade above.
  await prisma.referralPartner.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
  await prisma.operatorOutreachEvent.deleteMany({ where: { operatorSlug: { startsWith: SLUG_PREFIX } } });
  await prisma.operatorLead.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
});

async function seedAccount(displayName: string) {
  return prisma.bluePassAccount.create({
    data: {
      email: `${EMAIL_PREFIX}${randomUUID()}@ops.bluepass.co`,
      passwordHash: randomUUID(),
      displayName,
      // BluePassAccount.phone is unique now - every seeded account needs its own; the UUID suffix
      // guarantees that regardless of how many accounts this file seeds.
      phone: `+61${randomUUID()}`,
    },
  });
}

/** A claim needs a claimable operator behind it, which an OperatorLead row supplies. */
async function seedClaim() {
  const name = `${NAME_PREFIX} Charters ${randomUUID()}`;
  const slug = `${SLUG_PREFIX}${randomUUID()}`;
  const account = await seedAccount(name);

  await prisma.operatorLead.create({
    data: { slug, name, source: "test", websiteUrl: "https://operator.example" },
  });
  const claim = await prisma.operatorClaim.create({
    data: {
      operatorSlug: slug,
      operatorName: name,
      accountId: account.id,
      status: "PENDING_REVIEW",
      claimantName: `${NAME_PREFIX} Skipper`,
      claimantEmail: account.email,
      claimantPhone: "+61400999888",
      claimantRole: "Owner",
      proofUrl: "https://operator.example/about",
      notes: "Registered owner since 2011.",
    },
  });
  // Mirrors what createOperatorClaimForAccount does — approveOperatorClaim updates this profile.
  await prisma.operatorProfile.create({
    data: { accountId: account.id, status: "PENDING_REVIEW", companyName: name },
  });

  return { account, claim, slug, name };
}

async function seedPartnerApplication() {
  const account = await seedAccount(`${NAME_PREFIX} Partner ${randomUUID()}`);
  const profile = await prisma.partnerProfile.create({
    data: {
      accountId: account.id,
      status: "PENDING_REVIEW",
      handle: `${NAME_PREFIX} @handle`,
      instagramUrl: "https://instagram.example/handle",
    },
  });

  return { account, profile };
}

async function seedOperatorApplication() {
  const companyName = `${NAME_PREFIX} Dive ${randomUUID()}`;
  const account = await seedAccount(companyName);
  const profile = await prisma.operatorProfile.create({
    data: { accountId: account.id, status: "PENDING_REVIEW", companyName, country: "AU" },
  });

  return { account, profile, companyName };
}

describe("listPendingApprovals", () => {
  it("surfaces a pending claim with enough contact detail to decide on", async () => {
    const { claim, name } = await seedClaim();

    const { claims } = await listPendingApprovals();
    const row = claims.find((item) => item.id === claim.id);

    expect(row).toBeDefined();
    expect(row?.kind).toBe("operator-claim");
    expect(row?.title).toBe(name);
    expect(row?.notes).toBe("Registered owner since 2011.");

    const labels = row?.facts.map((fact) => fact.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["Claimant", "Email", "Phone", "Proof"]));
    expect(row?.facts.find((f) => f.label === "Email")?.href).toBe(`mailto:${claim.claimantEmail}`);
  });

  it("lists partner and operator applications together, oldest first", async () => {
    const partner = await seedPartnerApplication();
    const operator = await seedOperatorApplication();

    const { applications } = await listPendingApprovals();
    const ids = applications.map((item) => item.id);

    expect(ids).toContain(partner.profile.id);
    expect(ids).toContain(operator.profile.id);
    expect(applications.find((i) => i.id === partner.profile.id)?.kind).toBe("partner-application");
    expect(applications.find((i) => i.id === operator.profile.id)?.kind).toBe("operator-application");
    expect(ids.indexOf(partner.profile.id)).toBeLessThan(ids.indexOf(operator.profile.id));
  });

  it("hides an operator profile that a pending claim already represents", async () => {
    /* Submitting a claim also flips that account's OperatorProfile to PENDING_REVIEW. Listing both
       would invite an admin to approve the claim and decline the profile behind it. */
    const { account, claim } = await seedClaim();
    const profile = await prisma.operatorProfile.findUniqueOrThrow({
      where: { accountId: account.id },
    });

    const { claims, applications } = await listPendingApprovals();

    expect(claims.map((i) => i.id)).toContain(claim.id);
    expect(applications.map((i) => i.id)).not.toContain(profile.id);
  });
});

describe("resolveApproval", () => {
  it("approves an operator claim, cascading to the profile and provisioning a referral link", async () => {
    const { account, claim } = await seedClaim();

    await resolveApproval({
      kind: "operator-claim",
      id: claim.id,
      decision: "approve",
      reviewerEmail: REVIEWER,
    });

    const reviewed = await prisma.operatorClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(reviewed.status).toBe("APPROVED");
    expect(reviewed.reviewedBy).toBe(REVIEWER);
    expect(reviewed.reviewedAt).not.toBeNull();

    const profile = await prisma.operatorProfile.findUniqueOrThrow({
      where: { accountId: account.id },
      include: { referralPartner: { include: { links: true } } },
    });
    expect(profile.status).toBe("APPROVED");
    expect(profile.referralPartner?.links.length).toBeGreaterThan(0);

    // It drops out of the queue the moment it is decided.
    const { claims } = await listPendingApprovals();
    expect(claims.map((i) => i.id)).not.toContain(claim.id);
  });

  it("declines an operator claim without approving anything", async () => {
    const { account, claim } = await seedClaim();

    await resolveApproval({
      kind: "operator-claim",
      id: claim.id,
      decision: "decline",
      reviewerEmail: REVIEWER,
    });

    const reviewed = await prisma.operatorClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(reviewed.status).toBe("DECLINED");
    expect(reviewed.reviewedBy).toBe(REVIEWER);

    const profile = await prisma.operatorProfile.findUniqueOrThrow({ where: { accountId: account.id } });
    expect(profile.status).toBe("PENDING_REVIEW");
  });

  it("approves a partner application and gives them a referral partner", async () => {
    const { profile } = await seedPartnerApplication();
    const notifyPartnerApproved = vi.fn(async () => undefined);

    await resolveApproval(
      {
        kind: "partner-application",
        id: profile.id,
        decision: "approve",
        reviewerEmail: REVIEWER,
      },
      { notifyPartnerApproved },
    );

    // The welcome email goes out once, for this partner; approving again does not send another.
    expect(notifyPartnerApproved).toHaveBeenCalledTimes(1);
    expect(notifyPartnerApproved).toHaveBeenCalledWith(profile.id);
    await resolveApproval(
      { kind: "partner-application", id: profile.id, decision: "approve", reviewerEmail: REVIEWER },
      { notifyPartnerApproved },
    );
    expect(notifyPartnerApproved).toHaveBeenCalledTimes(1);

    const reviewed = await prisma.partnerProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: { referralPartner: { include: { links: true } } },
    });
    expect(reviewed.status).toBe("APPROVED");
    expect(reviewed.referralPartner?.role).toBe("PARTNER");
    expect(reviewed.referralPartner?.links.length).toBeGreaterThan(0);
  });

  it("declines a partner application without provisioning a partner", async () => {
    const { profile } = await seedPartnerApplication();

    await resolveApproval({
      kind: "partner-application",
      id: profile.id,
      decision: "decline",
      reviewerEmail: REVIEWER,
    });

    const reviewed = await prisma.partnerProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(reviewed.status).toBe("DECLINED");
    expect(reviewed.referralPartnerId).toBeNull();
  });

  it("approves and declines operator applications on the right table", async () => {
    const approved = await seedOperatorApplication();
    const declined = await seedOperatorApplication();

    await resolveApproval({
      kind: "operator-application",
      id: approved.profile.id,
      decision: "approve",
      reviewerEmail: REVIEWER,
    });
    await resolveApproval({
      kind: "operator-application",
      id: declined.profile.id,
      decision: "decline",
      reviewerEmail: REVIEWER,
    });

    const approvedRow = await prisma.operatorProfile.findUniqueOrThrow({
      where: { id: approved.profile.id },
      include: { referralPartner: true },
    });
    expect(approvedRow.status).toBe("APPROVED");
    expect(approvedRow.referralPartner?.role).toBe("OPERATOR");

    const declinedRow = await prisma.operatorProfile.findUniqueOrThrow({
      where: { id: declined.profile.id },
    });
    expect(declinedRow.status).toBe("DECLINED");
    expect(declinedRow.referralPartnerId).toBeNull();
  });

  it("throws rather than silently succeeding on an id that does not exist", async () => {
    await expect(
      resolveApproval({
        kind: "operator-claim",
        id: "claim-that-does-not-exist",
        decision: "approve",
        reviewerEmail: REVIEWER,
      }),
    ).rejects.toThrow();
  });
});
