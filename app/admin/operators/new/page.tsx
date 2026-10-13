import AdminPageHeader from "@/components/admin/AdminPageHeader";
import OperatorOnboardingForm from "@/components/admin/OperatorOnboardingForm";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";

export const metadata = { title: "New operator · Bluepass Admin" };

/* Accepts the lead's own details as query params so "they signed" from the outreach list lands here
   with the business already filled in — the admin only has to add what BD could not scrape (payout
   details, country). `leadId` rides along hidden so the lead can be marked signed once the profile
   actually exists. */
export default async function NewOperatorPage({
  searchParams,
}: {
  searchParams: Promise<{
    leadId?: string;
    companyName?: string;
    whatsappE164?: string;
    websiteUrl?: string;
    payoutContactEmail?: string;
  }>;
}) {
  await requireAdminOrRedirect("/admin/operators/new");

  const params = await searchParams;

  return (
    <>
      <AdminPageHeader
        title="New operator"
        support="For an operator you have already closed by phone or email. This creates a real, live profile with real payout details — not a placeholder waiting to be claimed."
      />
      <OperatorOnboardingForm
        leadId={params.leadId}
        initialValues={{
          companyName: params.companyName ?? "",
          whatsappE164: params.whatsappE164 ?? "",
          websiteUrl: params.websiteUrl ?? "",
          payoutContactEmail: params.payoutContactEmail ?? "",
        }}
      />
    </>
  );
}
