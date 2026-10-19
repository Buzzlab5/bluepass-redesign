/**
 * Claim pages for the Barbados marine operators that have no working website of their own,
 * so there is nothing to build a full page from: name, what they run, where, and the
 * contact the operator census holds (an email only where its domain takes mail). The
 * operators with a website get full pages from scripts/import-operator-pages.ts instead.
 *
 *   npx tsx --env-file=.env.local scripts/import-barbados-leads.ts "../operator-pages-pilot/barbados/census/leads-no-website.json"
 *
 * Safe to run again. A slug already used by a lead from anywhere else is left alone.
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { upsertOperatorLeads, type OperatorLeadImportRow } from "@/lib/services/operators/operator-leads";

type Row = { slug: string; name: string; category: string; region: string; email: string | null; phone: string | null; websiteUrl: string | null };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass the leads file.");
  const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];
  const taken = new Set((await prisma.operatorLead.findMany({ where: { slug: { in: rows.map((r) => r.slug) }, source: { not: "barbados" } }, select: { slug: true } })).map((l) => l.slug));
  const fresh: OperatorLeadImportRow[] = rows
    .filter((r) => !taken.has(r.slug))
    .map((r) => ({ slug: r.slug, name: r.name, category: r.category, region: r.region, email: r.email ?? undefined, phone: r.phone ?? undefined, websiteUrl: r.websiteUrl ?? undefined }));
  await upsertOperatorLeads(fresh, { source: "barbados" });
  console.log(`Barbados leads: ${fresh.length} imported${taken.size ? `, ${taken.size} skipped (slug used elsewhere: ${[...taken].join(", ")})` : ""}`);
}

main().finally(() => prisma.$disconnect());
