import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import PartnerAdminEditForm from "@/components/admin/PartnerAdminEditForm";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { getPartnerForEdit } from "@/lib/services/admin/partner-directory";

export const metadata = { title: "Edit partner · Bluepass Admin" };

export default async function EditPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/partners/${id}`);

  const partner = await getPartnerForEdit(id);

  if (!partner) {
    notFound();
  }

  return (
    <>
      <AdminPageHeader
        title={partner.handle ?? partner.accountEmail}
        support={`Created ${partner.createdAt.toISOString().slice(0, 10)} · signed in as ${partner.accountEmail}. Category and notes take effect immediately — approval/decline still happens on Approvals.`}
      />
      <PartnerAdminEditForm partner={partner} />
    </>
  );
}
