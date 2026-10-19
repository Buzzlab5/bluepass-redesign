/**
 * A local-only creator with an approved creator account, so the creator's side of operator
 * onboarding can be tried: an operator picks them, they accept in the partner portal, share
 * their post, and the operator sees it.
 *
 *   npx tsx --env-file=.env.local scripts/seed-creator-demo.ts
 *
 * Test creator sign-in (local only, never a real account):
 *   email:    demo-creator@bluepass.test
 *   password: sea-creator-a45593b9
 *
 * Refuses to touch anything but a local database.
 */
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/services/auth/password";

const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`Refusing to seed a demo creator into a non-local database (${host}).`);
}

const EMAIL = "demo-creator@bluepass.test";
const PASSWORD = "sea-creator-a45593b9";

async function main() {
  const account = await prisma.bluePassAccount.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, passwordHash: hashPassword(PASSWORD), emailVerifiedAt: new Date(), displayName: "Demo Creator", roles: ["TRAVELLER", "PARTNER"] },
    update: { passwordHash: hashPassword(PASSWORD), roles: ["TRAVELLER", "PARTNER"] },
  });
  const partner = await prisma.referralPartner.findFirst({ where: { email: EMAIL } })
    ?? await prisma.referralPartner.create({ data: { role: "PARTNER", name: "Demo Creator", handle: "democreator", email: EMAIL } });
  const profile = await prisma.partnerProfile.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id, referralPartnerId: partner.id, status: "APPROVED", partnerCategory: "CREATOR", handle: "democreator",
      instagramUrl: "https://www.instagram.com/democreator/", audienceUrl: "https://democreator.example",
    },
    update: { status: "APPROVED", partnerCategory: "CREATOR", referralPartnerId: partner.id },
  });
  // Their directory entry: a Queensland reef and whale shooter, so reef and whale operators are matched to them.
  await prisma.creator.upsert({
    where: { partnerProfileId: profile.id },
    create: {
      slug: "demo-creator", name: "Demo Creator", source: "partner", partnerProfileId: profile.id, website: "https://democreator.example",
      instagram: "democreator", baseState: "QLD", baseTown: "Noosa", regions: ["Sunshine Coast", "Noosa"],
      specialties: ["whales", "kayak", "dolphins", "reef", "photo", "video"], summary: "A local test creator.",
    },
    update: { baseState: "QLD", baseTown: "Noosa", regions: ["Sunshine Coast", "Noosa"], specialties: ["whales", "kayak", "dolphins", "reef", "photo", "video"] },
  });
  console.log(`${EMAIL} is an approved creator.`);
}

main().finally(() => prisma.$disconnect());
