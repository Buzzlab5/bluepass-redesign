import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import OperatorEditForm from "@/components/admin/OperatorEditForm";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { getOperatorForEdit } from "@/lib/services/admin/operator-edit";

export const metadata = { title: "Edit operator · Bluepass Admin" };

export default async function EditOperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/operators/${id}`);

  const operator = await getOperatorForEdit(id);

  if (!operator) {
    notFound();
  }

  return (
    <>
      <AdminPageHeader
        title={operator.companyName ?? operator.accountEmail}
        support={`Created ${operator.createdAt.toISOString().slice(0, 10)} · signed in as ${operator.accountEmail}. Changes here take effect immediately — there is no separate review step for an edit.`}
      />
      <OperatorEditForm operator={operator} />
    </>
  );
}
