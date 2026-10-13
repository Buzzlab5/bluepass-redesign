import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ClaimFrame from "@/components/operators/ClaimFrame";
import SiteFooter from "@/components/SiteFooter";
import { PreparedOperatorView } from "@/components/operators/PreparedViews";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import { loadPublicOperatorLead } from "@/lib/services/operators/operator-public-lead";
import { loadPreparedPage } from "@/lib/services/operators/prepared-pages";

export const dynamic = "force-dynamic";

/**
 * The public page for an operator Bluepass has prepared but who has not claimed
 * it yet. Every outreach message links here or to the claim page beside it;
 * `operator-outreach-list.ts` has been generating this URL for some time while
 * the route itself did not exist, so every claim link sent so far has landed on
 * a 404.
 *
 * Two decisions worth stating, because both are about not abusing somebody
 * else's name:
 *
 * 1. An unclaimed page is `noindex`. Bluepass built it from a BD list, not at
 *    the operator's request, so it must not compete with the operator's own
 *    site in search or turn up when somebody googles the business. It exists to
 *    be the honest destination of a link we sent, nothing more. Once a claim is
 *    approved the page is theirs and can be indexed.
 * 2. The page says plainly, above everything else, that it is a placeholder the
 *    operator has not seen. Reading as though the business already had an
 *    account here would be a small lie in the first sentence of the
 *    relationship.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lead = await loadPublicOperatorLead(slug);

  if (!lead) {
    return { title: "Operator not found | Bluepass", robots: { index: false, follow: false } };
  }

  return {
    title: `${lead.name} | Bluepass`,
    description: `${lead.name} on Bluepass. A fixed 5% of every booking goes to ocean conservation.`,
    // Unclaimed pages stay out of the index. See the note above.
    robots: lead.claimed ? undefined : { index: false, follow: false },
  };
}

export default async function PublicOperatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string; view?: string }>;
}) {
  const { slug } = await params;
  // A page prepared from the operator's own website shows once a person has checked it.
  // Before that, an admin can preview it with ?preview=1; anyone else sees the plain page.
  const query = await searchParams;
  const preview = query.preview === "1" && Boolean(await requireCurrentAdmin());
  const travellerView = preview && query.view === "traveller";
  const prepared = await loadPreparedPage(slug, { preview, travellerPhotos: travellerView });
  if (prepared) {
    return (
      <>
        <PreparedOperatorView data={prepared} preview={preview} travellerView={travellerView} />
        <SiteFooter />
      </>
    );
  }

  const lead = await loadPublicOperatorLead(slug);

  if (!lead) notFound();

  const website = lead.websiteUrl ? (lead.websiteUrl.startsWith("http") ? lead.websiteUrl : `https://${lead.websiteUrl}`) : null;

  return (
    <>
      <ClaimFrame kicker={lead.category} title={lead.name} sub={lead.region} seed={lead.slug}>
        {!lead.claimed ? (
          <div className="opp-msg">
            <p className="opp-sheet__small">
              This is a page Bluepass prepared for {lead.name}. Nobody from the business has claimed it yet, so nothing here is confirmed by them and no trips are bookable.
            </p>
          </div>
        ) : null}
        <p>
          Bluepass is a booking platform for marine tourism. Operators set their own prices and it is free to list. We only earn a commission when we bring a booking, and a fixed 5% of every booking goes back to the ocean it happens on.
        </p>
        {website ? (
          <p className="opp-sheet__small">
            Their own site: <a href={website} rel="nofollow noopener noreferrer" target="_blank">{lead.websiteUrl?.replace(/^https?:\/\//, "")}</a>
          </p>
        ) : null}
        {lead.claimable && !lead.claimed ? (
          <>
            <div className="opp-sheet__divider" />
            <h2 className="ds-headline">Is this your business?</h2>
            <p>Claim the page and you control what it says. We email a link to the business address we already hold, so nobody else can take it.</p>
            <Link className="bk-cta" href={`/operator/claim/start/${lead.slug}`}>Claim this page</Link>
          </>
        ) : null}
        {lead.claimed ? <p className="opp-sheet__small">This page has been claimed by its operator.</p> : null}
      </ClaimFrame>
      <SiteFooter />
    </>
  );
}
