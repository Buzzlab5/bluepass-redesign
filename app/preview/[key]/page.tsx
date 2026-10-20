import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DiscoverPageContent from "@/components/discover/DiscoverPageContent";
import KaiUnlock from "@/components/KaiUnlock";
import { isPreviewKey } from "@/lib/services/discover/preview-access";

/* Rendered per request: the key in the address decides what comes back, so nothing here may be
   cached and served to someone without it. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bluepass trips (preview)",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The trips page and the Kai chat while they are locked to the public: the same page, behind a private address.
 *
 * Anyone without the right key gets the same 404 as any address that does not exist, so the page
 * does not announce that a door is here. The key is `DISCOVER_PREVIEW_KEY` in Vercel; remove it (or
 * simply unlock the site) and this address stops working. Nothing about it needs to change at launch.
 */
export default async function TripsPreviewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isPreviewKey(decodeURIComponent(key))) notFound();

  return (
    <>
      {/* The chat is off for the public too; here it is on, so the preview shows the whole launch page. */}
      <KaiUnlock />
      <DiscoverPageContent operatorTripsFirst />
    </>
  );
}
