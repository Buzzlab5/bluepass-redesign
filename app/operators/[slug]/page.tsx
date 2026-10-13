import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  // A page prepared from the operator's own website shows once a person has checked it.
  // Before that, an admin can preview it with ?preview=1; anyone else sees the plain page.
  const preview = (await searchParams).preview === "1" && Boolean(await requireCurrentAdmin());
  const prepared = await loadPreparedPage(slug, { preview });
  if (prepared) {
    return (
      <>
        <PreparedOperatorView data={prepared} preview={preview} />
        <SiteFooter />
      </>
    );
  }

  const lead = await loadPublicOperatorLead(slug);

  if (!lead) notFound();

  const where = [lead.category, lead.region].filter(Boolean).join(" · ");

  return (
    <>
      <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-32 sm:px-8">
        {!lead.claimed && (
          <p className="mb-8 border-l-2 border-[var(--color-accent-blue)] pl-4 text-sm leading-relaxed text-[var(--color-ink-muted)]">
            This is a page Bluepass prepared for {lead.name}. Nobody from the business has claimed
            it yet, so nothing here has been confirmed by them and no trips are bookable.
          </p>
        )}

        <h1 className="font-[family-name:var(--font-geist)] text-4xl leading-tight tracking-tight text-[var(--color-ink)] sm:text-5xl">
          {lead.name}
        </h1>

        {where && (
          <p className="mt-3 text-sm uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
            {where}
          </p>
        )}

        <div className="mt-10 space-y-5 text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
          <p>
            Bluepass is a booking platform for marine tourism. Operators set their own rates and it
            is free to list. We only earn a commission when we bring you a booking, and a fixed 5%
            of every booking goes back to the ocean you work in.
          </p>
          {lead.websiteUrl && (
            <p>
              Their own site:{" "}
              <a
                className="underline underline-offset-4 hover:text-[var(--color-ink)]"
                href={lead.websiteUrl.startsWith("http") ? lead.websiteUrl : `https://${lead.websiteUrl}`}
                rel="nofollow noopener noreferrer"
                target="_blank"
              >
                {lead.websiteUrl.replace(/^https?:\/\//, "")}
              </a>
            </p>
          )}
        </div>

        {lead.claimable && !lead.claimed && (
          <div className="mt-12 border-t border-[var(--color-hairline)] pt-8">
            <h2 className="font-[family-name:var(--font-geist)] text-xl text-[var(--color-ink)]">
              Is this your business?
            </h2>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
              Claim the page and you control what it says. We send a link to the business address we
              already hold, so nobody else can take it.
            </p>
            <Link
              className="mt-6 inline-block bg-[var(--color-primary)] px-6 py-3 text-[15px] font-medium text-[var(--color-on-primary)] transition-opacity hover:opacity-90"
              href={`/operator/claim/start/${lead.slug}`}
            >
              Claim this page
            </Link>
          </div>
        )}

        {lead.claimed && (
          <p className="mt-12 border-t border-[var(--color-hairline)] pt-8 text-[15px] text-[var(--color-ink-muted)]">
            This page has been claimed by its operator.
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
