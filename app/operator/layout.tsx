import type { Metadata } from "next";
import type { ReactNode } from "react";
import OperatorNav from "@/components/operator/OperatorNav";
import { currentOperatorPathname, requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { hasClaimedPreparedPage } from "@/lib/services/operators/prepared-pages";
import { railsAccess } from "@/lib/services/rails/access";
import "../rails.css";
import "../theme-light.css";

export const metadata: Metadata = {
  title: "Bluepass Operator",
  robots: { index: false, follow: false },
};

/* Same reason as the admin console: every page under here reads one specific operator's live rows
   and must never be served from a cache shared with another operator. */
export const dynamic = "force-dynamic";

/**
 * The operator area's frame, and the first of the two places the operator check happens.
 *
 * This gate protects the *rendering* — it is what stops a traveller, or an operator without a
 * profile of their own, ever seeing a payout ledger. Any server action added under here must call
 * `requireOperatorOrRedirect` again for itself and re-check that the row it is about to touch
 * belongs to *that* operator; this check has already finished by the time such a button is pressed.
 */
export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const pathname = await currentOperatorPathname();
  const { account, profile } = await requireOperatorOrRedirect(pathname);
  const [rails, hasPreparedPage] = await Promise.all([railsAccess(profile), hasClaimedPreparedPage(account.id)]);

  return (
    /* Deliberately the admin console's shell, unmodified. An operator and an admin are looking at
       variations of the same kind of page, and this area having its own visual language meant two
       sets of console styles to keep in step — with the operator's half always the one lagging.
       Consistency here is the feature. */
    <div className="adm theme-light">
      <aside className="adm__rail">
        <OperatorNav companyName={profile.companyName} email={account.email} railsEnabled={rails.enabled} hasPreparedPage={hasPreparedPage} />
      </aside>
      <main className="adm__main">
        <div className="adm__inner">{children}</div>
      </main>
    </div>
  );
}
