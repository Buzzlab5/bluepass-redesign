/**
 * A Bluepass admin account for local development only, so the admin console can be
 * opened against the demo data.
 *
 *   npx tsx --env-file=.env.local scripts/seed-admin-demo.ts
 *
 * Test admin sign-in (local only, never a real account):
 *   email:    demo-admin@bluepass.test
 *   password: reef-admin-3ee1b3f2
 *
 * Refuses to touch anything but a local database.
 */
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/services/auth/password";

const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`Refusing to seed an admin into a non-local database (${host}).`);
}

const EMAIL = "demo-admin@bluepass.test";
const PASSWORD = "reef-admin-3ee1b3f2";

async function main() {
  await prisma.bluePassAccount.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, passwordHash: hashPassword(PASSWORD), emailVerifiedAt: new Date(), displayName: "Demo Admin", roles: ["ADMIN"] },
    update: { passwordHash: hashPassword(PASSWORD), roles: ["ADMIN"] },
  });
  console.log(`Admin ready: ${EMAIL}`);
}

main().finally(() => prisma.$disconnect());
