import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { currentOperatorPathname, requireOperatorOrRedirect } from "@/lib/services/operator/guard";

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

  return (
    /* The same console shell as admin, CRM and partner: one visual language for every console. */
    <ConsoleShell
      area="Operator"
      groups={[
        {
          label: "Menu",
          items: [
            { href: "/operator", label: "Dashboard", icon: "dashboard" },
            { href: "/operator/trips", label: "Trips", icon: "trips" },
            { href: "/operator/bookings", label: "Bookings", icon: "approvals" },
          ],
        },
      ]}
      person={profile.companyName ?? account.email}
      role="Operator"
    >
      {children}
    </ConsoleShell>
  );
}
