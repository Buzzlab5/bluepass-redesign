import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConsoleShell, { type ConsoleNavGroup } from "@/components/console/ConsoleShell";
import { ADMIN_SECTIONS } from "@/lib/services/admin/sections";
import { currentAdminPathname, requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { countPendingApprovals } from "@/lib/services/admin/review-queue";

export const metadata: Metadata = {
  title: "Bluepass Admin",
  robots: { index: false, follow: false },
};

/* Every page under here reads live rows and must never be served from a cache
   shared between admins — an approvals queue rendered once and replayed would
   show work that has already been done. */
export const dynamic = "force-dynamic";

/**
 * The console frame, and the first of the two places the admin check happens.
 *
 * This gate protects the *rendering* — it stops a non-admin ever seeing
 * claimant contact details or payout fields. It does not protect the writes:
 * every server action calls `requireCurrentAdmin()` again for itself, because
 * this check has already finished by the time those buttons are pressed.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = await currentAdminPathname();
  const admin = await requireAdminOrRedirect(pathname);
  const pendingApprovals = await countPendingApprovals();

  const groups: ConsoleNavGroup[] = [
    {
      label: "Menu",
      items: [
        { href: "/admin", label: "Overview", icon: "overview", exact: true },
        ...ADMIN_SECTIONS.filter((section) => section.group === "Menu").map((section) => ({
          href: section.href,
          label: section.label,
          icon: section.icon,
          count: section.counter === "pendingApprovals" ? pendingApprovals : undefined,
        })),
      ],
    },
    {
      label: "Content and money",
      items: ADMIN_SECTIONS.filter((section) => section.group !== "Menu").map((section) => ({
        href: section.href,
        label: section.label,
        icon: section.icon,
      })),
    },
    { label: "Tools", items: [{ href: "/crm", label: "Outreach CRM", icon: "leads" }] },
  ];

  return (
    <ConsoleShell area="Admin" groups={groups} person={admin.displayName || admin.email} role="Admin">
      {children}
    </ConsoleShell>
  );
}
