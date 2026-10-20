// A dummy partner (creator) account for trying the partner portal (/partner-portal).
//   node --env-file=.env scripts/dummy-partner.mjs          create it, or reset its password
//   node --env-file=.env scripts/dummy-partner.mjs remove   delete it and everything under it
//
// There is no separate test database, so this account lives in the same database as production and
// can sign in on bluepass.co as well as locally. Its email is on the placeholder domain, which the
// admin approvals queue hides. The password is random, is written to .env.dummy-partner (ignored by
// git, readable only by you) and is never printed.
import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const EMAIL = "dummy-partner@ops.bluepass.co";
const NAME = "Dummy Partner (test)";
const HANDLE = "dummypartner";
const CODE = "dummy-partner-test";
const SECRET_FILE = ".env.dummy-partner";

// Same format as lib/services/auth/password.ts: scrypt$<salt>$<key>
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

async function remove() {
  const account = await prisma.bluePassAccount.findUnique({ where: { email: EMAIL }, select: { partnerProfile: { select: { referralPartnerId: true } } } });
  const { count } = await prisma.bluePassAccount.deleteMany({ where: { email: EMAIL } });
  // The referral partner is not owned by the account, so it is removed on its own.
  const referral = account?.partnerProfile?.referralPartnerId;
  if (referral) await prisma.referralPartner.deleteMany({ where: { id: referral } });
  console.log(count ? "Removed the dummy partner, its profile and its referral link." : "Nothing to remove.");
}

async function create() {
  const password = randomBytes(12).toString("base64url");
  const passwordHash = hashPassword(password);

  const account = await prisma.bluePassAccount.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, passwordHash, displayName: NAME, roles: ["TRAVELLER", "PARTNER"], emailVerifiedAt: new Date() },
    update: { passwordHash, roles: ["TRAVELLER", "PARTNER"], emailVerifiedAt: new Date() },
  });

  const existing = await prisma.partnerProfile.findUnique({ where: { accountId: account.id }, select: { referralPartnerId: true } });
  const referralPartnerId =
    existing?.referralPartnerId ??
    (
      await prisma.referralPartner.create({
        data: {
          role: "PARTNER",
          name: NAME,
          handle: HANDLE,
          email: EMAIL,
          links: { create: { code: CODE, label: `${NAME} main link`, targetPath: "/" } },
        },
      })
    ).id;

  await prisma.partnerProfile.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      referralPartnerId,
      status: "APPROVED",
      handle: HANDLE,
      partnerCategory: "CREATOR",
      notes: "Dummy account created by scripts/dummy-partner.mjs for testing the partner portal. Safe to delete.",
    },
    update: { status: "APPROVED", referralPartnerId },
  });

  writeFileSync(SECRET_FILE, `# Dummy partner login (created ${new Date().toISOString()}). Keep private.\nEMAIL=${EMAIL}\nPASSWORD=${password}\n`);
  chmodSync(SECRET_FILE, 0o600);

  // Check what the app will check: the password verifies, the role is there, the profile is approved.
  const stored = await prisma.bluePassAccount.findUniqueOrThrow({
    where: { id: account.id },
    select: { passwordHash: true, roles: true, emailVerifiedAt: true, partnerProfile: { select: { status: true, handle: true, referralPartner: { select: { links: { select: { code: true } } } } } } },
  });
  const [, salt, key] = stored.passwordHash.split("$");
  const passwordOk = scryptSync(password, salt, 64).toString("hex") === key;
  console.log(JSON.stringify({ email: EMAIL, passwordVerifies: passwordOk, roles: stored.roles, emailVerified: Boolean(stored.emailVerifiedAt), profile: stored.partnerProfile }));
  console.log(`Login details saved to ${SECRET_FILE}`);
}

(process.argv[2] === "remove" ? remove() : create())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
