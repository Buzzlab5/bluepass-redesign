/**
 * The printed half of the Barbados claim kit, from the same list as /admin/visits:
 *
 *   cards.pdf        one A6 card per operator who has not claimed yet: their photo, their
 *                    page in a line, and a code to scan that opens their claim page
 *   visit-list.pdf   every operator by town, with what to take and what to raise
 *   visit-list.csv   the same list for a spreadsheet
 *
 *   npx tsx --env-file=.env.local scripts/barbados-claim-kit.ts "../bb_out/kit/claim-cards" "../linkedin/_work/fonts"
 *
 * The second folder holds static Inter and Geist files (Inter-400.ttf, Geist-600.ttf …);
 * variable web fonts print blurry. Card wording follows the kit's rules: Bluepass with a
 * lowercase p, the 5% the only percentage, no promises the agreement has not made.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import QRCode from "qrcode";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { checkCopy } from "@/lib/services/agents/tools/copy-rules";
import { barbadosVisits, type VisitStop } from "@/lib/services/operators/visits";

const out = resolve(process.argv[2] ?? "../bb_out/kit/claim-cards");
const fonts = process.argv[3] ? resolve(process.argv[3]) : null;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const FOOTER = "Free to list, and you set your own prices. 5% of every booking goes to Barbadian ocean charities.";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fontFaces() {
  if (!fonts) return "";
  const face = (family: string, file: string, weight: number) =>
    existsSync(join(fonts, file)) ? `@font-face { font-family: "${family}"; src: url("${pathToFileURL(join(fonts, file)).href}"); font-weight: ${weight}; }` : "";
  return [face("Inter", "Inter-400.ttf", 400), face("Inter", "Inter-500.ttf", 500), face("Inter", "Inter-600.ttf", 600), face("Geist", "Geist-600.ttf", 600), face("Geist", "Geist-700.ttf", 700)].join("\n");
}

const BASE_CSS = `
${fontFaces()}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; color: #0f0f0f; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Inter, -apple-system, "Helvetica Neue", Arial, sans-serif; }
`;

function line(s: VisitStop) {
  if (s.page !== "full") return "Your page on Bluepass is ready to claim.";
  return `Your page on Bluepass is ready: ${s.trips} ${s.trips === 1 ? "trip" : "trips"}${s.fromPrice ? `, from ${s.fromPrice}` : ""}.`;
}

/**
 * The operator's photo at print size (about 300 dpi across the card), held in memory only.
 * Chrome would otherwise embed every original at full size: 141 cards came to 99 MB.
 */
async function printPhoto(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).resize(1240, 640, { fit: "cover" }).jpeg({ quality: 78 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch {
    return null;
  }
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function cardHtml(stops: VisitStop[]) {
  const photos = await inBatches(stops, 8, (s) => printPhoto(s.heroImage));
  const cards = await Promise.all(stops.map(async (s, i) => {
    const qr = await QRCode.toString(s.claimUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0f0f0f", light: "#ffffff" } });
    const photo = photos[i]
      ? `<div class="photo"><img src="${photos[i]}" alt=""><span class="brand">Bluepass</span><span class="town">${esc(s.town)}</span></div>`
      : `<div class="photo none"><span class="brand">Bluepass</span><span class="town">${esc(s.town)}</span></div>`;
    return `<section class="card">
      ${photo}
      <div class="body">
        <p class="name">${esc(s.name)}</p>
        <p class="line">${esc(line(s))}</p>
        <div class="scan">
          <div class="qr">${qr}</div>
          <p class="how">Scan to see your page, correct anything, and claim it as yours.</p>
        </div>
        <p class="foot">${esc(FOOTER)}<br><strong>bluepass.co</strong></p>
      </div>
    </section>`;
  }));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  @page { size: 105mm 148mm; margin: 0; }
  .card { width: 105mm; height: 148mm; display: flex; flex-direction: column; page-break-after: always; overflow: hidden; }
  .photo { position: relative; height: 54mm; background: #0f0f0f; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo .town { position: absolute; left: 7mm; bottom: 4mm; font-size: 8pt; font-weight: 500; color: #ffffff; letter-spacing: 0.02em; }
  .photo .brand { position: absolute; left: 7mm; top: 4mm; font-family: Geist, Inter, sans-serif; font-weight: 700; font-size: 9pt; color: #ffffff; }
  .photo:not(.none) .town, .photo:not(.none) .brand { padding: 1mm 2.4mm; border-radius: 99px; background: #0f0f0f; }
  .photo:not(.none) .brand { left: 5.6mm; top: 3.6mm; }
  .body { flex: 1; display: flex; flex-direction: column; padding: 6mm 7mm 6mm; gap: 3mm; }
  .name { margin: 0; font-family: Geist, Inter, sans-serif; font-weight: 700; font-size: 16pt; line-height: 1.1; letter-spacing: -0.01em; }
  .line { margin: 0; font-size: 9pt; line-height: 1.4; color: #3a3a3a; }
  .scan { display: flex; align-items: center; gap: 5mm; margin-top: 1mm; }
  .qr { flex: none; width: 40mm; height: 40mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .how { margin: 0; font-size: 10pt; line-height: 1.4; font-weight: 500; }
  .foot { margin: auto 0 0; font-size: 7pt; line-height: 1.45; color: #6b6b6b; }
  .foot strong { color: #0f0f0f; font-weight: 600; }
  </style></head><body>${cards.join("\n")}</body></html>`;
}

function listHtml(stops: VisitStop[]) {
  const towns = new Map<string, VisitStop[]>();
  for (const s of stops) towns.set(s.town, [...(towns.get(s.town) ?? []), s]);
  const rows = [...towns.entries()].map(([town, list]) => `
    <h2>${esc(town)} <span>${list.length}</span></h2>
    <table><tbody>${list.map((s) => `
      <tr>
        <td class="box">${s.claimed ? "✓" : ""}</td>
        <td><strong>${esc(s.name)}</strong><br><span class="muted">${s.page === "full" ? `${s.trips} ${s.trips === 1 ? "trip" : "trips"}${s.fromPrice ? `, from ${esc(s.fromPrice)}` : ""}` : "Claim page only"}</span></td>
        <td>${s.email ? esc(s.email) : '<span class="ask">Take their email</span>'}</td>
        <td>${s.phone ? esc(s.phone) : ""}${s.whatsapp ? `<br><span class="muted">WhatsApp</span>` : ""}</td>
        <td class="muted">${esc(s.flags.filter((f) => f !== "no email on file").join(", "))}</td>
      </tr>`).join("")}
    </tbody></table>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  @page { size: A4; margin: 14mm 12mm; }
  h1 { font-family: Geist, Inter, sans-serif; font-size: 18pt; margin: 0 0 2mm; }
  .intro { margin: 0 0 6mm; font-size: 9pt; color: #3a3a3a; }
  h2 { font-family: Geist, Inter, sans-serif; font-size: 11pt; margin: 6mm 0 2mm; break-after: avoid; }
  h2 span { color: #8a8a8a; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  td { padding: 2mm 2mm 2mm 0; border-top: 0.3mm solid #e2e2e2; vertical-align: top; }
  tr { break-inside: avoid; }
  .box { width: 6mm; text-align: center; }
  .box:empty::before { content: ""; display: inline-block; width: 3.2mm; height: 3.2mm; border: 0.3mm solid #8a8a8a; border-radius: 0.6mm; }
  .muted { color: #6b6b6b; }
  .ask { font-weight: 600; }
  </style></head><body>
  <h1>Barbados visits</h1>
  <p class="intro">${stops.length} operators, ${stops.filter((s) => s.claimed).length} claimed. Tick each one as they claim. Where we hold no email, take their business email in person on the Visits page in the admin, then ask them to scan their card. Printed ${new Date().toISOString().slice(0, 10)}.</p>
  ${rows}
  </body></html>`;
}

function csv(stops: VisitStop[]) {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["town", "name", "slug", "page", "trips", "from", "email", "phone", "whatsapp", "flags", "claimed", "claim_url"];
  return [head.join(","), ...stops.map((s) => [s.town, s.name, s.slug, s.page, s.trips, s.fromPrice, s.email, s.phone, s.whatsapp, s.flags.join("; "), s.claimed ? "yes" : "no", s.claimUrl].map(cell).join(","))].join("\n");
}

function readme(cards: number, all: number) {
  return `# Barbados claim kit

Made by \`scripts/barbados-claim-kit.ts\` on ${new Date().toISOString().slice(0, 10)} from the operator pages in the database. Run it again after any change; it rewrites everything here.

| File | What it is |
|---|---|
| \`cards.pdf\` | ${cards} A6 cards, one per operator who has not claimed: their photo, their page in a line, and a code that opens their claim page |
| \`visit-list.pdf\` | All ${all} operators by town, with a box to tick, the email we hold or "Take their email", phone, WhatsApp, and what to raise |
| \`visit-list.csv\` | The same list for a spreadsheet |

## On the visit

1. Open **Visits** in the admin on your phone (\`/admin/visits\`), go to the operator.
2. Show them their page ("Show them their page").
3. If it says we hold no email, take their business email and save it there.
4. They scan the code on their card (or on your phone). The claim link goes to that email; they open it and claim in one press.

## Before this is used

- The codes open \`bluepass.co/operator/claim/start/<operator>\`. They only work once the Barbados pages and claim pages are imported into the live database.
- Pages not yet checked at /admin/operator-pages are not public, but the operator still sees theirs when they claim.
- The footer line ("Free to list, and you set your own prices. 5% of every booking goes to Barbadian ocean charities.") goes to counsel with the rest of the kit.
`;
}

async function main() {
  const blocked = checkCopy(`${FOOTER} Scan to see your page, correct anything, and claim it as yours.`, { audience: "operator" });
  if (!blocked.pass) throw new Error(`Card wording breaks the copy rules: ${blocked.blocking.map((b) => b.rule).join(", ")}`);
  mkdirSync(out, { recursive: true });
  const stops = await barbadosVisits();
  const toVisit = stops.filter((s) => !s.claimed);

  writeFileSync(join(out, "cards.html"), await cardHtml(toVisit));
  writeFileSync(join(out, "visit-list.html"), listHtml(stops));
  writeFileSync(join(out, "visit-list.csv"), csv(stops));
  writeFileSync(join(out, "README.md"), readme(toVisit.length, stops.length));

  const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
  try {
    const page = await browser.newPage();
    for (const [html, pdf, opts] of [
      ["cards.html", "cards.pdf", { width: "105mm", height: "148mm" }],
      ["visit-list.html", "visit-list.pdf", { format: "A4" }],
    ] as const) {
      await page.goto(pathToFileURL(join(out, html)).href, { waitUntil: "networkidle", timeout: 180_000 }).catch(() => undefined);
      await page.pdf({ path: join(out, pdf), printBackground: true, preferCSSPageSize: true, ...opts });
    }
  } finally {
    await browser.close();
  }
  console.log(`Claim kit: ${toVisit.length} cards, ${stops.length} on the visit list → ${out}`);
}

main().finally(() => prisma.$disconnect());
