/**
 * A local-only operator who has claimed one prepared page, through the real claim flow
 * (claim submitted, then approved), so the operator's side of a prepared page can be
 * opened: choosing which of their photos travellers see.
 *
 *   npx tsx --env-file=.env.local scripts/seed-claim-demo.ts coral-sea-dreaming
 *
 * Test operator sign-in (local only, never a real account):
 *   email:    demo-owner@bluepass.test
 *   password: reef-owner-e0ed7fd2
 *
 * Refuses to touch anything but a local database.
 */
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/services/auth/password";
import { approveOperatorClaim, createOperatorClaimForAccount } from "@/lib/services/operators/operator-claim-service";

const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`Refusing to seed a demo operator into a non-local database (${host}).`);
}

const EMAIL = "demo-owner@bluepass.test";
const PASSWORD = "reef-owner-e0ed7fd2";
const slug = process.argv[2] ?? "coral-sea-dreaming";

async function main() {
  const account = await prisma.bluePassAccount.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, passwordHash: hashPassword(PASSWORD), emailVerifiedAt: new Date(), displayName: "Demo Owner", roles: ["TRAVELLER"] },
    update: { passwordHash: hashPassword(PASSWORD) },
  });
  const claim = await createOperatorClaimForAccount({
    accountId: account.id, operatorSlug: slug, claimantName: "Demo Owner", claimantEmail: EMAIL, authorized: true,
  });
  await approveOperatorClaim({ claimId: claim.id, reviewerEmail: "demo-admin@bluepass.test" });
  console.log(`${EMAIL} has claimed ${slug}, approved.`);
}

main().finally(() => prisma.$disconnect());
