import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import ClaimBar from "@/components/operator/ClaimBar";
import ClaimVerifyForm from "@/components/operator/ClaimVerifyForm";
import ClaimFrame from "@/components/operators/ClaimFrame";
import { PreparedOperatorView, PreparedTripView, type PageLinks } from "@/components/operators/PreparedViews";
import SiteFooter from "@/components/SiteFooter";
import { getCurrentTraveller } from "@/lib/services/auth/session";
import { resolveOperatorClaimToken } from "@/lib/services/operators/operator-claim-tokens";
import { reviewForClaim } from "@/lib/services/operators/prepared-claim";

export const dynamic = "force-dynamic";

/**
 * Where the claim email lands. `buildOperatorClaimUrl` in
 * `operator-claim-tokens.ts` has been putting this URL into every claim email,
 * and the route did not exist, so the funnel broke one step after the operator
 * did the thing we asked them to do.
 *
 * Never indexed, and `force-dynamic`: the page is keyed on a single-use secret
 * in the query string, so there is nothing here that may be cached or served to
 * a second visitor.
 *
 * A business Bluepass prepared a page for sees that page, every photo included, and
 * claims it in one press. Anyone else gets the slower form, reviewed by Bluepass. A
 * wrong or expired link gets a plain explanation and a way back, not a form that fails
 * on submit.
 */
export const metadata: Metadata = {
  title: "Confirm your claim | Bluepass",
  robots: { index: false, follow: false },
};

function Frame({ kicker, title, seed, children }: { kicker?: string; title: string; seed: string; children: ReactNode }) {
  return (
    <>
      <ClaimFrame kicker={kicker} title={title} seed={seed}>{children}</ClaimFrame>
      <SiteFooter />
    </>
  );
}

/** Why a press of "Claim and publish" came back, in the operator's terms. */
const CLAIM_PROBLEMS: Record<string, string> = {
  elsewhere: "Your email already manages another page on Bluepass. Write to hello@bluepass.co and we will connect both.",
  invalid: "This link has expired or been used. Ask for a new one from your page.",
  failed: "That did not go through. Try again, or write to hello@bluepass.co.",
};

export default async function ClaimVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; trip?: string; error?: string }>;
}) {
  const { token, trip, error } = await searchParams;

  if (!token) {
    return (
      <Frame title="This link is incomplete" seed="claim">
        <p>Open the link from your email exactly as it was sent. If your mail app shortened it, copy the whole address into your browser instead.</p>
      </Frame>
    );
  }

  const review = await reviewForClaim(token);
  if (review.ok) {
    const base = `/operator/claim/verify?token=${encodeURIComponent(token)}`;
    const links: PageLinks = { page: base, trip: (tripSlug) => `${base}&trip=${encodeURIComponent(tripSlug)}` };
    const site = review.page.page.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const problem = error ? CLAIM_PROBLEMS[error] ?? CLAIM_PROBLEMS.failed : null;
    const bar = <ClaimBar token={token} name={review.name} site={site} error={problem} />;
    const onTrip = trip && review.page.trips.some((t) => t.slug === trip);
    return (
      <div className="opp--claim">
        {onTrip
          ? <PreparedTripView data={review.page} tripSlug={trip} preview={false} links={links} banner={bar} />
          : <PreparedOperatorView data={review.page} preview={false} links={links} banner={bar} />}
        <SiteFooter />
      </div>
    );
  }
  if (review.reason === "claimed") {
    return (
      <Frame kicker="Already claimed" title={review.message.replace(/ has already been claimed\.$/, "")} seed={review.slug ?? "claim"}>
        <p>This page has already been claimed.</p>
        <p className="opp-sheet__small">
          If that was you, <Link href="/login?next=/operator/your-page">sign in</Link> to manage it. If not, write to <a href="mailto:hello@bluepass.co">hello@bluepass.co</a>.
        </p>
      </Frame>
    );
  }

  const result = await resolveOperatorClaimToken(token);

  if (!result.ok) {
    return (
      <Frame title="This claim link no longer works" seed="claim">
        <p>{result.error}</p>
        <p className="opp-sheet__small">
          Claim links last seven days and work once. Ask for a new one from your page, or write to <a href="mailto:hello@bluepass.co">hello@bluepass.co</a>.
        </p>
      </Frame>
    );
  }

  const lead = result.operatorLead;
  const traveller = await getCurrentTraveller();

  // Submitting a claim requires an account, because the claim has to attach to
  // one. Rather than letting the form fail with a 401, send them to sign in and
  // bring them straight back to this same token.
  if (!traveller?.accountId) {
    const next = encodeURIComponent(`/operator/claim/verify?token=${encodeURIComponent(token)}`);
    return (
      <Frame kicker="Confirm your claim" title={lead.name} seed={lead.slug}>
        <p>Your link is valid. Sign in or create a Bluepass account and we will bring you straight back here to finish.</p>
        <div className="opp-closing__actions" style={{ alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap" }}>
          <Link className="bk-cta" href={`/register?next=${next}`}>Create an account</Link>
          <Link className="opp-contact" href={`/login?next=${next}`}>Sign in</Link>
        </div>
        <p className="opp-sheet__small">Your link stays valid for seven days, so it will still work after you sign in.</p>
      </Frame>
    );
  }

  return (
    <Frame kicker="Confirm your claim" title={lead.name} seed={lead.slug}>
      <p>Tell us who you are and we will review the claim. Nothing is published until we have written back to you.</p>
      <div className="opp-sheet__divider" />
      <ClaimVerifyForm businessName={lead.name} invitedEmail={result.claimToken.email} slug={lead.slug} websiteUrl={lead.websiteUrl} />
    </Frame>
  );
}
