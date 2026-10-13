// A dummy operator account for trying the operator dashboard (/operator).
//   node --env-file=.env scripts/dummy-operator.mjs          create it, or reset its password
//   node --env-file=.env scripts/dummy-operator.mjs remove   delete it and everything under it
//
// There is no separate test database, so this account lives in the same database as production and
// can sign in on bluepass.co as well as locally. A listing it publishes shows on the live site, so
// take such a listing down (or remove the account) when you are done. The password is random, is
// written to .env.dummy-operator (ignored by git, readable only by you) and is never printed.
import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const EMAIL = "dummy-operator@ops.bluepass.co";
const COMPANY = "Dummy Marine Tours (test)";
const SECRET_FILE = ".env.dummy-operator";

// Same format as lib/services/auth/password.ts: scrypt$<salt>$<key>
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

async function remove() {
  const { count } = await prisma.bluePassAccount.deleteMany({ where: { email: EMAIL } });
  console.log(count ? "Removed the dummy operator, its profile and its listings." : "Nothing to remove.");
}

async function create() {
  const password = randomBytes(12).toString("base64url");
  const passwordHash = hashPassword(password);

  const account = await prisma.bluePassAccount.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL,
      passwordHash,
      displayName: "Dummy Operator",
      roles: ["TRAVELLER", "OPERATOR"],
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash, roles: ["TRAVELLER", "OPERATOR"], emailVerifiedAt: new Date() },
  });

  await prisma.operatorProfile.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      companyName: COMPANY,
      status: "LIVE",
      country: "AU",
      payoutContactEmail: EMAIL,
      notes: "Dummy account created by scripts/dummy-operator.mjs for testing the operator dashboard. Safe to delete.",
    },
    update: { status: "LIVE" },
  });

  writeFileSync(SECRET_FILE, `# Dummy operator login (created ${new Date().toISOString()}). Keep private.\nEMAIL=${EMAIL}\nPASSWORD=${password}\n`);
  chmodSync(SECRET_FILE, 0o600);

  // Check what the app will check: the password verifies, the role is there, the profile exists.
  const stored = await prisma.bluePassAccount.findUniqueOrThrow({
    where: { id: account.id },
    select: { passwordHash: true, roles: true, emailVerifiedAt: true, operatorProfile: { select: { status: true, companyName: true } } },
  });
  const [, salt, key] = stored.passwordHash.split("$");
  const passwordOk = scryptSync(password, salt, 64).toString("hex") === key;
  console.log(JSON.stringify({ email: EMAIL, passwordVerifies: passwordOk, roles: stored.roles, emailVerified: Boolean(stored.emailVerifiedAt), profile: stored.operatorProfile }));
  console.log(`Login details saved to ${SECRET_FILE}`);
}

(process.argv[2] === "remove" ? remove() : create())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
