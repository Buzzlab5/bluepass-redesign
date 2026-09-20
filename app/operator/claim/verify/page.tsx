import type { Metadata } from "next";
import Link from "next/link";
import ClaimVerifyForm from "@/components/operator/ClaimVerifyForm";
import SiteFooter from "@/components/SiteFooter";
import { getCurrentTraveller } from "@/lib/services/auth/session";
import { resolveOperatorClaimToken } from "@/lib/services/operators/operator-claim-tokens";

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
 * The token is resolved server side before anything about the business is
 * rendered. A wrong or expired token gets a plain explanation and a way back,
 * not a form that fails on submit.
 */
export const metadata: Metadata = {
  title: "Confirm your claim | Bluepass",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-32 sm:px-8">{children}</main>
      <SiteFooter />
    </>
  );
}

export default async function ClaimVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Shell>
        <h1 className="font-[family-name:var(--font-geist)] text-3xl text-[var(--color-ink)]">
          This link is incomplete
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
          Open the link from your email exactly as it was sent. If your mail client shortened it,
          copy the whole address into your browser instead.
        </p>
      </Shell>
    );
  }

  const result = await resolveOperatorClaimToken(token);

  if (!result.ok) {
    return (
      <Shell>
        <h1 className="font-[family-name:var(--font-geist)] text-3xl text-[var(--color-ink)]">
          This claim link is no longer valid
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
          {result.error}
        </p>
        <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          Claim links last seven days and can be used once. You can ask for a new one from your
          page, or write to{" "}
          <a className="underline underline-offset-4" href="mailto:hello@bluepass.co">
            hello@bluepass.co
          </a>
          .
        </p>
      </Shell>
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
      <Shell>
        <p className="text-sm uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
          Confirm your claim
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-geist)] text-4xl leading-tight tracking-tight text-[var(--color-ink)]">
          {lead.name}
        </h1>
        <p className="mt-6 text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
          Your link is valid. Sign in or create a Bluepass account and we will bring you straight
          back here to finish.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            className="bg-[var(--color-primary)] px-6 py-3 text-[15px] font-medium text-[var(--color-on-primary)] transition-opacity hover:opacity-90"
            href={`/register?next=${next}`}
          >
            Create an account
          </Link>
          <Link
            className="border border-[var(--color-hairline)] px-6 py-3 text-[15px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink)]"
            href={`/login?next=${next}`}
          >
            Sign in
          </Link>
        </div>
        <p className="mt-6 text-sm text-[var(--color-ink-muted)]">
          Your link stays valid for seven days, so it will still work after you sign in.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
        Confirm your claim
      </p>
      <h1 className="mt-4 font-[family-name:var(--font-geist)] text-4xl leading-tight tracking-tight text-[var(--color-ink)]">
        {lead.name}
      </h1>
      <p className="mt-6 text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
        Tell us who you are and we will review the claim by hand. Nothing is published until we have
        written back to you.
      </p>

      <div className="mt-10 border-t border-[var(--color-hairline)] pt-8">
        <ClaimVerifyForm
          businessName={lead.name}
          invitedEmail={result.claimToken.email}
          slug={lead.slug}
          websiteUrl={lead.websiteUrl}
        />
      </div>
    </Shell>
  );
}
