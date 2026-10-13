import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { currentOperatorPathname, requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { isClaimPathname } from "@/lib/services/pathname";
import { operatorSections } from "@/lib/services/operator/sections";
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
  // The claim pages are where an operator arrives before they have an account: the link in
  // the claim email is the proof of who they are. They sit outside the gate and the shell.
  // Leaving them is always a full page load, so this layout renders again for the console.
  if (isClaimPathname(pathname)) return children;
  const { account, profile } = await requireOperatorOrRedirect(pathname);
  const [rails, hasPreparedPage] = await Promise.all([railsAccess(profile), hasClaimedPreparedPage(account.id)]);

  return (
    /* The same console shell as admin, CRM and partner, in the light theme the operator's booking
       screens are drawn in (theme-light.css). */
    <div className="theme-light">
      <ConsoleShell
        area="Operator"
        groups={[{
          label: "Menu",
          items: operatorSections(rails.enabled, hasPreparedPage).map((section) => ({ ...section, exact: section.href === "/operator" })),
        }]}
        person={profile.companyName ?? account.email}
        role="Operator"
      >
        {children}
      </ConsoleShell>
    </div>
  );
}
