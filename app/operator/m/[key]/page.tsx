import { notFound, redirect } from "next/navigation";
import { manifestPath } from "@/lib/services/rails/calendar-events";

/**
 * /operator/m/<listingId>_<epochMs>: the short link in an operator's WhatsApp alert.
 * Meta's link buttons take one variable at the end of the URL, so the departure is
 * packed into a single segment here and unpacked into the manifest's real address.
 * The manifest itself checks who is signed in.
 */
export default async function ManifestShortLink({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const match = /^([a-z0-9]+)_(\d{10,14})$/.exec(key);
  if (!match) notFound();
  redirect(manifestPath(match[1], new Date(Number(match[2]))));
}
