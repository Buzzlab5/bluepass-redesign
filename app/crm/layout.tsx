import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConsoleShell from "@/components/console/ConsoleShell";
import { currentCrmPathname, requireAdminOrRedirect } from "@/lib/services/admin/guard";

export const metadata: Metadata = {
  title: "Bluepass Outreach CRM",
  robots: { index: false, follow: false },
};

/* Same reasoning as app/admin/layout.tsx: a lead's status can change between two people looking at
   it minutes apart, so this must never be served from a shared cache. */
export const dynamic = "force-dynamic";

/**
 * The CRM's own frame - deliberately separate from AdminLayout. Same login, same
 * `requireAdminOrRedirect` gate (an admin account is still what unlocks this), but its own
 * unstyled-by-the-admin-sidebar shell so this page can be redesigned as its own thing without
 * dragging the real admin console's layout along with it. Every write still re-checks
 * `requireCurrentAdmin()` itself in app/crm/[id]/actions.ts, for the same reason the admin
 * console's actions do.
 */
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const pathname = await currentCrmPathname();
  const admin = await requireAdminOrRedirect(pathname);

  return (
    <ConsoleShell
      area="Outreach CRM"
      groups={[
        { label: "Outreach", items: [{ href: "/crm", label: "Leads", icon: "leads" }] },
        { label: "Admin", items: [{ href: "/admin", label: "Admin console", icon: "overview" }] },
      ]}
      person={admin.displayName || admin.email}
      role="Admin"
    >
      {children}
    </ConsoleShell>
  );
}
