import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LeadOutreachForm from "@/components/crm/LeadOutreachForm";
import Button from "@/components/ui/Button";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { getLeadForOutreach } from "@/lib/services/admin/lead-outreach";

export const metadata = { title: "Lead · Bluepass CRM" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/crm/${id}`);

  const lead = await getLeadForOutreach(id);

  if (!lead) {
    notFound();
  }

  /* Hands the lead's own details to the existing onboarding form rather than duplicating it here -
     that form is the only place that mints the account, encrypts payout details and runs the
     duplicate check, and none of that should get a second implementation. Onboarding itself still
     lives under /admin - it is real production-account creation, not the CRM's job. */
  const onboardHref = `/admin/operators/new?${new URLSearchParams({
    leadId: lead.id,
    companyName: lead.name,
    ...(lead.phone ? { whatsappE164: lead.phone } : {}),
    ...(lead.websiteUrl ? { websiteUrl: lead.websiteUrl } : {}),
    ...(lead.email ? { payoutContactEmail: lead.email } : {}),
  }).toString()}`;

  return (
    <>
      <AdminPageHeader
        title={lead.name}
        support={`${lead.category ?? "Uncategorised"} · ${lead.region ?? "Location unknown"} · found via ${lead.source === "rezdy-scrape" ? "Rezdy" : lead.source === "fareharbor-scrape" ? "FareHarbor" : lead.source}`}
        aside={
          lead.status === "APPROVED" || lead.status === "LIVE" ? null : (
            <Link href={onboardHref}>
              <Button variant="primary" magnetic={false}>
                They signed — onboard them
              </Button>
            </Link>
          )
        }
      />

      <LeadOutreachForm lead={lead} />
    </>
  );
}
