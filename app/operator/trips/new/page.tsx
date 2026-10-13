import AdminPageHeader from "@/components/admin/AdminPageHeader";
import TripEditor from "@/components/operator/TripEditor";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { EMPTY_TRIP_EDITOR } from "@/lib/services/operator/native-trip-editor";
import { operatorCanUseNativeTrips } from "@/lib/services/operator/native-trips";
import { redirect } from "next/navigation";

export const metadata = { title: "New trip · Bluepass" };

export default async function NewTripPage() {
  const { profile } = await requireOperatorOrRedirect("/operator/trips/new");
  if (!operatorCanUseNativeTrips(profile)) redirect("/operator/trips");

  return (
    <>
      <AdminPageHeader title="New trip" support="Fill in the details, then save a draft or publish it. Nothing is shown to travellers until you publish." />
      <TripEditor tripId={null} initial={EMPTY_TRIP_EDITOR} status={null} />
    </>
  );
}
