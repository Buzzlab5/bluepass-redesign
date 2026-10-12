import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { currentPartnerPathname, requirePartnerOrRedirect } from "@/lib/services/partner/guard";

export const metadata: Metadata = {
  title: "Bluepass Partner",
  robots: { index: false, follow: false },
};

/* Same reason as the operator console: every page under here reads one specific partner's live
   rows and must never be served from a cache shared with another partner. */
export const dynamic = "force-dynamic";

/**
 * The partner area's frame, and the first of the two places the partner check happens — the mirror
 * of OperatorLayout. Any server action added under here must call `requirePartnerOrRedirect` again
 * for itself; this check has already finished by the time a button is pressed.
 */
export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const pathname = await currentPartnerPathname();
  const { account, profile } = await requirePartnerOrRedirect(pathname);

  return (
    /* The same console shell as admin, CRM and operator: one visual language for every console. */
    <ConsoleShell
      area="Partner"
      groups={[{ label: "Menu", items: [{ href: "/partner-portal", label: "Dashboard", icon: "dashboard" }] }]}
      person={profile.handle ?? account.email}
      role="Partner"
    >
      {children}
    </ConsoleShell>
  );
}
