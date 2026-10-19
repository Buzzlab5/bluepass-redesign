/**
 * How complete each prepared page's media is: logo, hero, videos, gallery, and trips with
 * fewer than three photos. A page is complete with a logo, a hero and no thin trips.
 *
 *   npx tsx --env-file=.env.local scripts/media-coverage.ts
 */
import { prisma } from "@/lib/db/prisma";
import { loadPreparedPage, mediaCoverage } from "@/lib/services/operators/prepared-pages";

async function main() {
  const pages = await prisma.preparedOperatorPage.findMany({ orderBy: { slug: "asc" }, select: { slug: true } });
  let complete = 0;
  for (const { slug } of pages) {
    const loaded = await loadPreparedPage(slug, { preview: true });
    if (!loaded) continue;
    const c = mediaCoverage(loaded.page, loaded.trips);
    if (c.complete) complete += 1;
    console.log(`${c.status.padEnd(7)} ${slug.padEnd(36)} logo ${c.logo ? "yes" : "no "}  hero ${c.hero ? "yes" : "no "}  videos ${String(c.videos).padStart(2)}  gallery ${String(c.gallery).padStart(2)}  thin trips ${c.thinTrips}/${loaded.trips.length}`);
  }
  console.log(`${complete} of ${pages.length} pages have their media gathered`);
}

main().finally(() => prisma.$disconnect());
