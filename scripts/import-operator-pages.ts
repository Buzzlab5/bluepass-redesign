/**
 * Imports prepared operator pages: one JSON file per operator, in the shape described in
 * `operator-pages-pilot/SCHEMA.md` (facts from the operator's own website, each with its
 * source page). Everything arrives waiting for a person to check it at /admin/operator-pages.
 *
 *   npx tsx --env-file=.env.local scripts/import-operator-pages.ts "../operator-pages-pilot"
 *
 * Safe to run again: unchanged trips keep their check, changed ones go back to waiting,
 * and trips no longer in the file leave the page.
 *
 * Every photo is fetched and measured first (sharp, which Next already installs), and
 * banners, backgrounds, thumbnails and screenshots are left out of the page with the
 * reason shown on the check screen. Measurements are remembered for a week in
 * `.photo-checks.json` beside the files, so running again does not fetch every operator's
 * photos again.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { applyPhotoChecks, photosOf, type PhotoFinding } from "@/lib/services/operators/photo-check";
import { importPreparedOperator, type PreparedOperator } from "@/lib/services/operators/prepared-pages";

const folder = resolve(process.argv[2] ?? "../operator-pages-pilot");
const CACHE = join(folder, ".photo-checks.json");
const WEEK = 7 * 24 * 60 * 60 * 1000;
type Remembered = { finding: PhotoFinding; at: number };
const remembered: Record<string, Remembered> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const measured = new Map<string, PhotoFinding>(
  Object.entries(remembered).filter(([, r]) => Date.now() - r.at < WEEK).map(([url, r]) => [url, r.finding]),
);

async function measure(url: string): Promise<PhotoFinding> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "BluepassPhotoCheck/1.0 (+https://bluepass.co)" } });
    if ([401, 403, 429].includes(res.status)) return "blocked";
    if (!res.ok) return "missing";
    // A bot check (SiteGround answers 202 with a captcha page) stands in for the photo.
    if (!res.headers.get("content-type")?.startsWith("image/")) return "blocked";
    const bytes = Buffer.from(await res.arrayBuffer());
    const { width, height } = await sharp(bytes).metadata();
    const stats = await sharp(bytes).resize(256, 256, { fit: "inside" }).stats();
    const colour = stats.channels.slice(0, 3);
    if (!width || !height) return "missing";
    return { width, height, spread: colour.reduce((sum, c) => sum + c.stdev, 0) / colour.length };
  } catch {
    return "missing";
  }
}

async function measureAll(urls: string[]) {
  const queue = urls.filter((u) => !measured.has(u));
  // Two at a time: these are small businesses' own websites.
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const finding = await measure(url);
      measured.set(url, finding);
      // Only a photo that was measured is remembered; a block or an outage may have lifted by next time.
      if (typeof finding === "object") remembered[url] = { finding, at: Date.now() };
    }
  }));
  writeFileSync(CACHE, JSON.stringify(remembered, null, 1));
}

async function main() {
  const files = readdirSync(folder).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort();
  for (const file of files) {
    let op: PreparedOperator;
    try {
      op = JSON.parse(readFileSync(join(folder, file), "utf8"));
    } catch (error) {
      console.log(`${file}: not valid JSON (${error instanceof Error ? error.message : error})`);
      continue;
    }
    if (Array.isArray(op.trips)) {
      await measureAll(photosOf(op));
      op = applyPhotoChecks(op, measured);
    }
    const leftOut = (op.photosLeftOut?.length ?? 0) + (op.trips ?? []).reduce((n, t) => n + (t.photosLeftOut?.length ?? 0), 0);
    const result = await importPreparedOperator(op);
    console.log(result.ok
      ? `${op.slug}: ${result.created} new, ${result.updated} changed, ${result.unchanged} unchanged, ${result.removed} removed${leftOut ? `, ${leftOut} ${leftOut === 1 ? "photo" : "photos"} left out` : ""}`
      : `${op.slug ?? file}: not imported, ${result.problems.join("; ")}`);
  }
}

main().finally(() => prisma.$disconnect());
