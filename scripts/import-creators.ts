/**
 * Loads researched creators into the directory operators pick from during onboarding:
 * the JSON files in creator_outreach/au_creators (see SCHEMA.md there) and the Australian
 * creators on the outreach list (send_lists/all_waves.csv, Tier D). Safe to run again: a
 * creator is matched on their website, then their slug, and updated in place; anyone who
 * has since joined Bluepass keeps their link to their account.
 *
 *   npx tsx --env-file=.env.local scripts/import-creators.ts "../creator_outreach/au_creators" "../send_lists/all_waves.csv"
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db/prisma";
import { SPECIALTIES } from "@/lib/services/onboarding/creator-match";

type Researched = {
  name: string; brand?: string | null; website: string; instagram?: string | null; youtube?: string | null; tiktok?: string | null;
  contactEmail?: string | null; baseState?: string | null; baseTown?: string | null; regions?: string[]; specialties?: string[];
  summary?: string | null; sourceUrl?: string | null;
};

const ALLOWED = new Set<string>(SPECIALTIES);
const STATES = new Set(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);

function slugify(text: string) {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "creator";
}

function site(url: string | null | undefined) {
  if (!url) return null;
  const withScheme = /^https?:\/\//.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

function hostOf(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function handle(value: string | null | undefined) {
  if (!value) return null;
  const m = value.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  return (m ? m[1] : value).replace(/^@/, "").replace(/\/$/, "").trim() || null;
}

/** The outreach list has no specialties; these are read from a creator's name and site only. */
function guessSpecialties(text: string) {
  const out = new Set<string>();
  if (/freediv|apnea|apneista/i.test(text)) out.add("freedive");
  if (/photo|image|visual|focus/i.test(text)) out.add("photo");
  if (/film|motion|video/i.test(text)) out.add("video");
  if (/expedition|trips|hosted|workshop/i.test(text)) out.add("hosted-trips");
  if (/scuba|dive|diving|underwater/i.test(text)) out.add("dive");
  return [...out];
}

function fromCsv(path: string): Researched[] {
  const [header, ...lines] = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const cols = header.split(",");
  const parse = (line: string) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? "").trim()]));
  };
  return lines.map(parse)
    .filter((r) => /tier d|creator/i.test(r.Wave ?? "") && r.Country === "Australia" && r.Website)
    .map((r) => {
      const m = r.Company.match(/^(.*?)\s*\((.*)\)\s*$/);
      return {
        name: (m ? m[1] : r.Company).trim(),
        brand: m ? m[2].trim() : null,
        website: r.Website,
        instagram: handle(r.Instagram),
        contactEmail: r.Email || null,
        regions: r.Indonesia_Region ? r.Indonesia_Region.split(/,\s*/) : [],
        specialties: guessSpecialties(`${r.Company} ${r.Website}`),
        summary: null,
        sourceUrl: site(r.Website),
      };
    });
}

async function main() {
  const [folder, csv] = process.argv.slice(2);
  const researched: Researched[] = [];
  if (folder && existsSync(folder)) {
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".json")).sort()) {
      try {
        researched.push(...(JSON.parse(readFileSync(join(folder, file), "utf8")) as Researched[]));
      } catch (error) {
        console.log(`${file}: not valid JSON (${error instanceof Error ? error.message : error})`);
      }
    }
  }
  if (csv && existsSync(csv)) researched.push(...fromCsv(csv));

  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const r of researched) {
    const website = site(r.website);
    const host = hostOf(website);
    if (!r.name || !website || !host || seen.has(host)) { skipped += 1; continue; }
    seen.add(host);
    const data = {
      name: r.name.trim(), brand: r.brand?.trim() || null, website, instagram: handle(r.instagram), youtube: r.youtube ?? null, tiktok: r.tiktok ?? null,
      contactEmail: r.contactEmail?.trim() || null,
      baseState: r.baseState && STATES.has(r.baseState.toUpperCase()) ? r.baseState.toUpperCase() : null,
      baseTown: r.baseTown?.trim() || null,
      regions: (r.regions ?? []).map((x) => x.trim()).filter(Boolean),
      specialties: [...new Set((r.specialties ?? []).map((s) => s.trim().toLowerCase()).filter((s) => ALLOWED.has(s)))],
      summary: r.summary?.trim() || null, sourceUrl: r.sourceUrl ?? website,
    };
    const existing = await prisma.creator.findFirst({ where: { OR: [{ website: { contains: host } }, { slug: slugify(r.name) }] }, select: { id: true } });
    if (existing) {
      await prisma.creator.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      let slug = slugify(r.name);
      if (await prisma.creator.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${slugify(host).slice(0, 12)}`;
      await prisma.creator.create({ data: { ...data, slug, source: "research" } });
      created += 1;
    }
  }
  console.log(`creators: ${created} new, ${updated} updated, ${skipped} skipped (no website or a repeat)`);
}

main().finally(() => prisma.$disconnect());
