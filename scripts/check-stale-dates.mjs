#!/usr/bin/env node
/**
 * Flags user-facing dates in the source that are already in the past, e.g. a
 * "Next report: June 2026" card still live in October. Comments are ignored, so
 * only dates that can actually render on the site are reported.
 *
 *   node scripts/check-stale-dates.mjs            # exits 1 if anything is stale
 *   node scripts/check-stale-dates.mjs 2026-12-01 # pretend today is that date
 *
 * A hit is not always a bug ("Last updated 20 August 2026" is meant to be in the
 * past), so treat the output as a review list. Add `stale-ok` on the same line to
 * silence a date that is intentionally historical.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components", "lib", "content"];
const EXTS = [".ts", ".tsx", ".md", ".mdx", ".json"];
// Not public yet: Trips/home is behind WAITLIST_POPUP_ENABLED (coming soon), so its curated
// departures can't be seen. Remove this entry before launch.
const SKIP_FILES = ["lib/discover.ts"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const PATTERNS = [
  new RegExp(`\\b(?:(\\d{1,2})\\s+)?${MONTH_RE}\\.?\\s+(?:(\\d{1,2}),?\\s+)?(20\\d{2})\\b`, "g"),
  /\b(20\d{2})-(\d{2})-(\d{2})\b/g,
];

const today = new Date();
if (process.argv[2]) {
  const [y, m, d] = process.argv[2].split("-").map(Number);
  today.setFullYear(y, m - 1, d);
}
today.setHours(0, 0, 0, 0);
const todayLabel = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".") || /\.(test|spec)\./.test(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// Blank out comments but keep newlines so line numbers still match.
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

function monthIndex(name) {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

const hits = [];
for (const file of ROOTS.flatMap((r) => walk(r)).filter((f) => !SKIP_FILES.includes(f))) {
  const raw = readFileSync(file, "utf8");
  const lines = file.endsWith(".ts") || file.endsWith(".tsx") ? stripComments(raw).split("\n") : raw.split("\n");
  const rawLines = raw.split("\n");
  lines.forEach((line, i) => {
    if (rawLines[i].includes("stale-ok")) return;
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        let end;
        if (re === PATTERNS[0]) {
          const [, d, mon, d2, y] = m;
          const day = d ?? d2;
          // Month-only dates count as stale once the whole month is over.
          end = day ? new Date(+y, monthIndex(mon), +day) : new Date(+y, monthIndex(mon) + 1, 0);
        } else {
          end = new Date(+m[1], +m[2] - 1, +m[3]);
        }
        if (end < today) hits.push({ file, line: i + 1, text: m[0] });
      }
    }
  });
}

if (!hits.length) {
  console.log(`No past dates found (today = ${todayLabel}).`);
  process.exit(0);
}
console.log(`Past dates still in the source (today = ${todayLabel}):\n`);
for (const h of hits) console.log(`${relative(".", h.file)}:${h.line}  ${h.text}`);
process.exit(1);
