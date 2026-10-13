import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import { PreparedTripView } from "@/components/operators/PreparedViews";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { loadPreparedPage } from "@/lib/services/operators/prepared-pages";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; trip: string }> }): Promise<Metadata> {
  const { slug, trip } = await params;
  const page = await loadPreparedPage(slug);
  const found = page?.trips.find((t) => t.slug === trip);
  if (!page || !found) return { title: "Bluepass", robots: { index: false, follow: false } };
  return {
    title: `${found.trip.title} with ${page.page.name} | Bluepass`,
    description: found.trip.summary.slice(0, 160),
    // Prepared from the operator's own site and not yet confirmed by them: kept out of search, like the operator page.
    robots: page.lead.claimed ? undefined : { index: false, follow: false },
  };
}

/** One trip on a prepared operator page: everything the operator publishes about it, and their own booking link. */
export default async function PreparedTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; trip: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug, trip } = await params;
  const preview = (await searchParams).preview === "1" && Boolean(await requireCurrentAdmin());
  const page = await loadPreparedPage(slug, { preview });
  if (!page || !page.trips.some((t) => t.slug === trip)) notFound();
  return (
    <>
      <PreparedTripView data={page} tripSlug={trip} preview={preview} />
      <SiteFooter />
    </>
  );
}
