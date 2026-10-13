import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ClaimFrame from "@/components/operators/ClaimFrame";
import ClaimStartPanel from "@/components/operator/ClaimStartPanel";
import SiteFooter from "@/components/SiteFooter";
import {
  loadPublicOperatorLead,
  maskedClaimEmailFor,
} from "@/lib/services/operators/operator-public-lead";

/**
 * Where every claim link in operator outreach points. `operator-outreach-list.ts`
 * builds this URL for each lead, and until now the route did not exist, so the
 * whole outreach sequence led to a 404.
 *
 * Never indexed. It is the destination of a link we sent to one business, and
 * it names that business; there is no reason for it to be discoverable by
 * anybody else.
 */
export const metadata: Metadata = {
  title: "Claim your page | Bluepass",
  robots: { index: false, follow: false },
};

export default async function ClaimStartPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lead = await loadPublicOperatorLead(slug);

  if (!lead) notFound();

  // Only the masked form reaches the browser. The page confirms which inbox to
  // watch without disclosing the address to whoever opened the link.
  const maskedEmail = lead.hasEmailOnFile ? await maskedClaimEmailFor(slug) : null;

  return (
    <>
      <ClaimFrame kicker="Claim your page" title={lead.name} seed={lead.slug}>
        {lead.claimed ? (
          <>
            <p>This page has already been claimed.</p>
            <p className="opp-sheet__small">
              If that wasn&rsquo;t you, write to <a href="mailto:hello@bluepass.co">hello@bluepass.co</a> and we will look into it.
            </p>
          </>
        ) : (
          <>
            <p>
              Bluepass prepared a page for {lead.name}. We email a link to the business address we hold; open it to see your page with your photos, then claim it in one press and it goes live.
            </p>
            <p className="opp-sheet__small">
              Free to list, and you set your own prices. We only earn a commission when we bring you a booking, and a fixed 5% of every booking goes to ocean conservation.
            </p>
            <div className="opp-sheet__divider" />
            <ClaimStartPanel businessName={lead.name} maskedEmail={maskedEmail} slug={lead.slug} />
          </>
        )}
        <p className="opp-sheet__small"><Link href={`/operators/${lead.slug}`}>See the page as it stands ›</Link></p>
      </ClaimFrame>
      <SiteFooter />
    </>
  );
}
