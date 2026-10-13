import type { ReactNode } from "react";
import Contours from "@/components/operators/Contours";

/**
 * The frame for the claim pages and the plain operator page: the operator pages' dark
 * title block, and one white sheet of content laid over its foot. The site's navigation
 * sits on the dark block, the same as on every operator page.
 */
export default function ClaimFrame({ kicker, title, sub, seed, children }: {
  kicker?: string | null;
  title: string;
  sub?: ReactNode;
  seed: string;
  children: ReactNode;
}) {
  return (
    <main className="bk theme-light opp">
      <header className="opp-hero opp-hero--plain opp-hero--short">
        <Contours seed={seed} />
        <div className="opp-hero__copy">
          {kicker ? <p className="opp-hero__kicker">{kicker}</p> : null}
          <h1 className="ds-display-lg opp-hero__title">{title}</h1>
          {sub ? <p className="opp-hero__where">{sub}</p> : null}
        </div>
      </header>
      <div className="opp-wrap opp-wrap--narrow">
        <div className="opp-sheet">{children}</div>
      </div>
    </main>
  );
}
