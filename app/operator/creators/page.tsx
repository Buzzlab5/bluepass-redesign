import Link from "next/link";
import CreatorPicker from "@/components/operator/CreatorPicker";
import CreatorPicks from "@/components/operator/CreatorPicks";
import { cancelPickAction, pickCreatorsAction, reportNotFeaturedAction } from "@/app/operator/creators/actions";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { creatorChoices } from "@/lib/services/onboarding/creator-campaigns";
import { formatCredit, splitCredit } from "@/lib/services/onboarding/credits";
import { claimedPreparedPage } from "@/lib/services/operators/prepared-pages";

export const metadata = { title: "Creators · Bluepass" };

function longDate(d: Date) {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long" });
}

/**
 * Where a new operator lands: their creator credit, and the twenty creators who best suit
 * what they run, to pick three from. Later, the same page shows how those creators answered.
 */
export default async function OperatorCreatorsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { account } = await requireOperatorOrRedirect("/operator/creators");
  const [data, prepared, { welcome }] = await Promise.all([creatorChoices(account.id), claimedPreparedPage(account.id), searchParams]);
  const { credit, picks, slotsLeft, choices, operator, approved } = data;
  const shares = splitCredit(credit.availableCents, slotsLeft);
  const firstName = operator.name;
  const pageLive = Boolean(prepared?.pageLive);
  const canPick = approved && slotsLeft > 0 && credit.availableCents > 0;

  return (
    <div className="ob">
      <header className="ob-head">
        {welcome === "1" ? (
          <>
            <p className="ob-eyebrow">Welcome to Bluepass</p>
            <h1 className="ds-display-sm ob-title">You&rsquo;re in, {firstName}.</h1>
            <p className="ob-lede">{pageLive ? "Your page is live. " : ""}Here is {formatCredit(credit.grantedCents || 10_000)} to help travellers find your trips.</p>
          </>
        ) : (
          <>
            <h1 className="ds-display-sm ob-title">Creators</h1>
            <p className="ob-lede">Creators you picked to feature your trips, and your creator credit.</p>
          </>
        )}
      </header>

      <section className="ob-credit" aria-label="Your creator credit">
        <div className="ob-credit__amount">
          {/* With every creator picked, the credit is shown as what it is doing, not as nothing left. */}
          <span className="ob-credit__value">{formatCredit(!approved ? 10_000 : slotsLeft === 0 ? credit.setAsideCents : credit.availableCents)}</span>
          <span className="ob-credit__label">
            {!approved || !credit.setAsideCents ? "creator credit, on us" : slotsLeft === 0 ? "set aside for your creators" : "creator credit left to share"}
          </span>
        </div>
        <p className="ob-credit__note">
          {!approved
            ? "Yours as soon as your business is approved. It pays creators to feature your trips."
            : credit.expired
              ? "Your creator credit has expired."
              : slotsLeft
                ? `Shared between the creators you pick, ${formatCredit(shares[0] ?? 0)} each. It pays them when they feature your trips.${credit.expiresAt ? ` Pick by ${longDate(credit.expiresAt)}.` : ""}`
                : "It pays your three creators when they feature your trips. A creator who says no hands their share back to you."}
        </p>
      </section>

      {picks.length ? (
        <section className="ob-section" aria-labelledby="ob-yours">
          <h2 id="ob-yours" className="ds-headline">Your creators</h2>
          <CreatorPicks picks={picks} actions={{ cancel: cancelPickAction, report: reportNotFeaturedAction }} />
        </section>
      ) : null}

      {slotsLeft > 0 ? (
        <section className="ob-section" aria-labelledby="ob-pick">
          <header className="ob-section__head">
            <h2 id="ob-pick" className="ds-headline">{picks.some((p) => p.status !== "CANCELLED" && p.status !== "DECLINED") ? `Pick ${slotsLeft === 1 ? "one more creator" : `${slotsLeft} more creators`}` : "Pick three creators to feature your trips"}</h2>
            <p className="ob-sub">Matched to what you run and where you run it. Creators on Bluepass see your pick straight away; we invite the others for you.</p>
          </header>
          {choices.length ? (
            <CreatorPicker choices={choices} slots={slotsLeft} shareLabel={formatCredit(shares[0] ?? 0)} disabled={!canPick} action={pickCreatorsAction} />
          ) : (
            <p className="ob-empty">We are adding creators near you. Check back soon.</p>
          )}
        </section>
      ) : null}

      <section className="ob-next" aria-labelledby="ob-next">
        <h2 id="ob-next" className="ds-headline">What happens next</h2>
        <ol className="ob-steps">
          <li><strong>They hear from us.</strong> Creators on Bluepass see your pick now. We invite the others for you.</li>
          <li><strong>They feature your trips.</strong> Each gets a link that sends people straight to your page.</li>
          <li><strong>Your credit pays them.</strong> Their share is paid once they post. If a post does not feature you, tell us within a week.</li>
        </ol>
        <div className="ob-links">
          {pageLive && prepared ? <Link href={`/operators/${prepared.slug}`} target="_blank" className="ob-link">See your page ↗</Link> : null}
          <Link href="/operator" className="ob-link">Go to your dashboard ›</Link>
        </div>
      </section>
    </div>
  );
}
