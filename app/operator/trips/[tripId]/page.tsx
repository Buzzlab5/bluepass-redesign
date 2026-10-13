import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import TripEditor from "@/components/operator/TripEditor";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { tripToEditor } from "@/lib/services/operator/native-trip-editor";
import { loadOperatorTrip } from "@/lib/services/operator/native-trips";

export const metadata = { title: "Edit trip · Bluepass" };

export default async function EditTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { tripId } = await params;
  const { notice } = await searchParams;
  const { profile } = await requireOperatorOrRedirect(`/operator/trips/${tripId}`);
  const loaded = await loadOperatorTrip(profile, tripId);

  if (!loaded.ok) {
    if (/not found/i.test(loaded.message)) notFound();
    return (
      <>
        <AdminPageHeader title="Edit trip" />
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">This trip could not be loaded.</p>
          <p className="ds-body-sm adm-empty__body">{loaded.message}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <AdminPageHeader title={loaded.trip.title} support="Change anything here and save. Changes to a trip on sale apply to new bookings straight away." />
      <TripEditor
        key={loaded.trip.updatedAt}
        tripId={loaded.trip.id}
        initial={tripToEditor(loaded.trip, loaded.listing)}
        status={loaded.trip.status}
        notice={notice}
      />
    </>
  );
}
