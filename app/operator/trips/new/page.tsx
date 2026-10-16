import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import NewTripPanel from "@/components/operator/NewTripPanel";
import RailsUnavailable from "@/components/rails/RailsUnavailable";
import { requireRailsOperator } from "@/lib/services/rails/guard";

export const metadata = { title: "New trip · Bluepass" };

/**
 * Where a trip starts. What it is comes first; saving carries on to the trip's own page for when it
 * runs and what it costs, and publishing happens there too.
 */
export default async function NewTripPage() {
  const { profile, rails } = await requireRailsOperator("/operator/trips/new");
  if (!rails.enabled) return <RailsUnavailable title="New trip" reason={rails.reason} />;

  return (
    <>
      <p className="ds-caption rl-crumb">
        <Link href="/operator/trips">Trips</Link> <span aria-hidden>›</span> New
      </p>
      <AdminPageHeader
        title="New trip"
        support="Start with what travellers will read. Next you say when it runs and what it costs, then publish."
      />
      {profile.rezdySupplierId ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__title">Your trips come from Rezdy.</p>
          <p className="ds-body-sm adm-empty__body">
            Add or change them in Rezdy and they appear here on their own. <Link href="/operator/connections">See the connection</Link>.
          </p>
        </div>
      ) : (
        <NewTripPanel />
      )}
    </>
  );
}
