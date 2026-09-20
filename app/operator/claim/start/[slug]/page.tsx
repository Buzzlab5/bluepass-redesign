import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
      <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-32 sm:px-8">
        <p className="text-sm uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
          Claim your page
        </p>

        <h1 className="mt-4 font-[family-name:var(--font-geist)] text-4xl leading-tight tracking-tight text-[var(--color-ink)]">
          {lead.name}
        </h1>

        {lead.claimed ? (
          <div className="mt-10 space-y-5 text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
            <p>This page has already been claimed.</p>
            <p>
              If that was not you, write to{" "}
              <a className="underline underline-offset-4" href="mailto:hello@bluepass.co">
                hello@bluepass.co
              </a>{" "}
              and we will look into it.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-10 space-y-5 text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
              <p>
                Bluepass prepared a page for {lead.name}. Claiming it puts you in control of what it
                says, what you list and what you charge.
              </p>
              <p>
                You set your own rates and it is free to list. We only earn a commission when we
                bring you a booking, and a fixed 5% of every booking goes to ocean conservation.
              </p>
            </div>

            <div className="mt-10 border-t border-[var(--color-hairline)] pt-8">
              <ClaimStartPanel
                businessName={lead.name}
                maskedEmail={maskedEmail}
                slug={lead.slug}
              />
            </div>
          </>
        )}

        <p className="mt-12 text-sm text-[var(--color-ink-muted)]">
          <Link className="underline underline-offset-4" href={`/operators/${lead.slug}`}>
            See the page as it stands
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
