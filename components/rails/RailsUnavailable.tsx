import AdminPageHeader from "@/components/admin/AdminPageHeader";

export default function RailsUnavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <>
      <AdminPageHeader eyebrow="Bookings" title={title} />
      <div className="adm-card adm-empty">
        <p className="ds-body-sm adm-empty__title">{reason}</p>
        <p className="ds-body-sm adm-empty__body">
          Bluepass sells your trips from that system directly, so there is nothing to set up here. Your dashboard shows what Bluepass has sold for you.
        </p>
      </div>
    </>
  );
}
