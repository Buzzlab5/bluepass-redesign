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
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { prisma } from "@/lib/db/prisma";
import { mergeMedia, type OperatorMedia } from "@/lib/services/operators/media-merge";
import { applyPhotoChecks, photosOf, type PhotoFinding } from "@/lib/services/operators/photo-check";
import { importPreparedOperator, type PreparedOperator } from "@/lib/services/operators/prepared-pages";
import { isLightLogo } from "@/lib/services/operators/upload-image";
import { playable, videoLookup, vimeoStill, type PreparedVideo } from "@/lib/services/operators/videos";

const folder = resolve(process.argv[2] ?? "../operator-pages-pilot");
const CACHE = join(folder, ".photo-checks.json");
const WEEK = 7 * 24 * 60 * 60 * 1000;
type Remembered = { finding: PhotoFinding; at: number };
const remembered: Record<string, Remembered> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
// A measurement from before photos were fingerprinted is taken again.
const measured = new Map<string, PhotoFinding>(
  Object.entries(remembered)
    .filter(([, r]) => Date.now() - r.at < WEEK && typeof r.finding === "object" && r.finding.print)
    .map(([url, r]) => [url, r.finding]),
);

/** The photo's fingerprint (see `samePhoto`): 64 points of rising or falling brightness, as 16 hex digits. */
async function fingerprint(bytes: Buffer): Promise<string> {
  const { data } = await sharp(bytes).flatten({ background: "#ffffff" }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let print = "";
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) byte = (byte << 1) | (data[row * 9 + col] < data[row * 9 + col + 1] ? 1 : 0);
    print += byte.toString(16).padStart(2, "0");
  }
  return print;
}

/**
 * "unreachable" is a slow or failing server rather than a photo that is gone: small
 * operators' sites have bad minutes, and one of those must not strip a page of its photos.
 */
// What a browser asks for when it loads an <img>. Some image CDNs answer it differently from a
// plain request (one refused it outright), and a photo a browser cannot load is no use on a page.
const BROWSER_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

async function measure(url: string): Promise<PhotoFinding | "unreachable"> {
  try {
    const headers = { "user-agent": "BluepassPhotoCheck/1.0 (+https://bluepass.co)", accept: BROWSER_ACCEPT };
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers });
    if ([401, 403, 429].includes(res.status)) {
      // Refused as a browser would ask, but sent to a plain request: travellers would never see it.
      const plain = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000), headers: { "user-agent": headers["user-agent"] } }).catch(() => null);
      return plain?.ok && plain.headers.get("content-type")?.startsWith("image/") ? "missing" : "blocked";
    }
    if (res.status >= 500) return "unreachable";
    if (!res.ok) return "missing";
    // A bot check (SiteGround answers 202 with a captcha page) stands in for the photo.
    if (!res.headers.get("content-type")?.startsWith("image/")) return "blocked";
    const bytes = Buffer.from(await res.arrayBuffer());
    const { width, height } = await sharp(bytes).metadata();
    const stats = await sharp(bytes).resize(256, 256, { fit: "inside" }).stats();
    const colour = stats.channels.slice(0, 3);
    if (!width || !height) return "missing";
    return { width, height, spread: colour.reduce((sum, c) => sum + c.stdev, 0) / colour.length, bytes: bytes.length, print: await fingerprint(bytes) };
  } catch (error) {
    // A timeout or a dropped connection; a file that is not an image at all is missing.
    return error instanceof Error && /abort|timeout|fetch failed|ECONN|socket/i.test(`${error.name} ${error.message}`) ? "unreachable" : "missing";
  }
}

/** Whether the logo is pale marks for a dark header (see `isLightLogo`); false when it will not load. */
async function logoIsLight(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "BluepassPhotoCheck/1.0 (+https://bluepass.co)" } });
    return res.ok ? isLightLogo(Buffer.from(await res.arrayBuffer())) : false;
  } catch {
    return false;
  }
}

/**
 * Asks a video lookup for its status and, for oEmbed, its answer. Some networks block
 * vimeo.com by name (Indonesia's do), so a lookup that cannot connect is tried once more
 * through curl with DNS over HTTPS. Null means no answer either way.
 */
async function lookup(url: string, method: "GET" | "HEAD"): Promise<{ status: number; type: string; body: string } | null> {
  try {
    const res = await fetch(url, { method, signal: AbortSignal.timeout(20_000), headers: { "user-agent": "BluepassPhotoCheck/1.0 (+https://bluepass.co)" } });
    return { status: res.status, type: res.headers.get("content-type") ?? "", body: method === "GET" ? await res.text() : "" };
  } catch {
    try {
      const args = ["-s", "--max-time", "20", "--doh-url", "https://cloudflare-dns.com/dns-query", "-w", "\n%{http_code} %{content_type}", ...(method === "HEAD" ? ["-I"] : []), url];
      const { stdout } = await promisify(execFile)("curl", args, { maxBuffer: 4 * 1024 * 1024 });
      const [status, type = ""] = stdout.slice(stdout.lastIndexOf("\n") + 1).split(" ");
      return Number(status) ? { status: Number(status), type, body: stdout.slice(0, stdout.lastIndexOf("\n")) } : null;
    } catch {
      return null;
    }
  }
}

/**
 * Each video checked the way a page would play it. YouTube and Vimeo refuse a private,
 * removed or embed-barred video through oEmbed, and Vimeo's answer carries its still; a
 * file has to answer as a video. One that cannot play is left out with the reason. With no
 * answer at all, the video stays.
 */
async function checkVideos(op: PreparedOperator): Promise<PreparedOperator> {
  if (!op.videos?.length) return op;
  const videos: PreparedVideo[] = [];
  const videosLeftOut: { url: string; reason: string }[] = [];
  for (const video of op.videos) {
    const p = playable(video);
    if (!p) {
      videosLeftOut.push({ url: video.url, reason: "not a YouTube, Vimeo or video file link" });
      continue;
    }
    const answer = await lookup(videoLookup(p), p.kind === "file" ? "HEAD" : "GET");
    if (answer && [400, 401, 403, 404, 410].includes(answer.status)) {
      videosLeftOut.push({ url: video.url, reason: p.kind === "file" ? "their site will not send the file" : "private, removed or not allowed on other sites" });
      continue;
    }
    if (answer?.status === 200 && p.kind === "file" && !answer.type.startsWith("video/")) {
      videosLeftOut.push({ url: video.url, reason: "the link is not a video file" });
      continue;
    }
    if (answer?.status === 200 && p.kind === "vimeo") {
      try {
        const body = JSON.parse(answer.body) as { thumbnail_url?: string; domain_status_code?: number };
        // Vimeo answers 200 for a video locked to the operator's own domain, and says so here.
        if (body.domain_status_code && body.domain_status_code !== 200) {
          videosLeftOut.push({ url: video.url, reason: "set to play only on the operator's own website" });
          continue;
        }
        videos.push({ ...video, poster: vimeoStill(body.thumbnail_url) });
        continue;
      } catch {
        // An answer that is not oEmbed's JSON says nothing; keep the video as it is.
      }
    }
    videos.push(video);
  }
  const { videosLeftOut: _before, ...rest } = op;
  return { ...rest, videos, ...(videosLeftOut.length ? { videosLeftOut } : {}) };
}

async function measureAll(urls: string[]) {
  const queue = urls.filter((u) => !measured.has(u));
  // Two at a time: these are small businesses' own websites.
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const result = await measure(url);
      // An unreachable photo keeps its last measurement, however old; with none, a person judges it.
      const finding = result === "unreachable" ? remembered[url]?.finding ?? "blocked" : result;
      measured.set(url, finding);
      if (result === "unreachable") continue;
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
    // The operator's own photos, videos and logo, gathered separately into media/<slug>.json.
    const mediaFile = join(folder, "media", file);
    if (Array.isArray(op.trips) && existsSync(mediaFile)) {
      try {
        op = mergeMedia(op, JSON.parse(readFileSync(mediaFile, "utf8")) as OperatorMedia);
      } catch (error) {
        console.log(`${file}: media file not valid JSON (${error instanceof Error ? error.message : error})`);
      }
    }
    if (Array.isArray(op.trips)) {
      const photos = photosOf(op);
      await measureAll(photos);
      // A site whose photos are mostly refused to us refuses them to travellers' browsers too.
      const refused = photos.filter((u) => measured.get(u) === "blocked").length;
      op = { ...applyPhotoChecks(op, measured), photosRefused: photos.length > 0 && refused / photos.length >= 0.5 };
      if (op.logo) op = { ...op, logoLight: await logoIsLight(op.logo) };
      op = await checkVideos(op);
    }
    const leftOut = (op.photosLeftOut?.length ?? 0) + (op.trips ?? []).reduce((n, t) => n + (t.photosLeftOut?.length ?? 0), 0);
    const videosOut = op.videosLeftOut?.length ?? 0;
    const result = await importPreparedOperator(op);
    console.log(result.ok && result.claimed
      ? `${op.slug}: claimed by the operator, left as they have it`
      : result.ok
      ? `${op.slug}: ${result.created} new, ${result.updated} changed, ${result.unchanged} unchanged, ${result.removed} removed${leftOut ? `, ${leftOut} ${leftOut === 1 ? "photo" : "photos"} left out` : ""}${videosOut ? `, ${videosOut} ${videosOut === 1 ? "video" : "videos"} left out` : ""}`
      : `${op.slug ?? file}: not imported, ${result.problems.join("; ")}`);
  }
}

main().finally(() => prisma.$disconnect());
