import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BookingChooser from "@/components/operator/BookingChooser";
import FactEditor from "@/components/admin/FactEditor";
import PhotoChooser from "@/components/operator/PhotoChooser";
import { pageEditor, tripEditor } from "@/components/operators/editorFields";
import { chooseBookingAction, choosePhotosAction, correctPageAction, correctTripAction } from "@/app/operator/your-page/actions";
import { requireOperatorOrRedirect } from "@/lib/services/operator/guard";
import { preparedBookingFor } from "@/lib/services/operators/prepared-booking";
import { claimedPreparedPage, loadPreparedPage } from "@/lib/services/operators/prepared-pages";

export const metadata = { title: "Your page · Bluepass" };

/**
 * The page Bluepass prepared for this operator from their website, and what they can do
 * with it: choose which photos travellers see, correct anything the page says, and, once
 * Rezdy is connected, check which Rezdy trip each trip books through. Bluepass matches
 * those by name; the operator only corrects what it could not tell.
 */
export default async function OperatorPagePhotos({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { account } = await requireOperatorOrRedirect("/operator/your-page");
  const [claimed, booking, { welcome }] = await Promise.all([claimedPreparedPage(account.id), preparedBookingFor(account.id), searchParams]);
  const loaded = claimed?.claimApproved ? await loadPreparedPage(claimed.slug, { preview: true }) : null;

  if (!claimed) {
    return (
      <AdminPageHeader title="No prepared page" support="Bluepass has not prepared a page for your business. Your trips show from what you add under Trips." />
    );
  }

  return (
    <>
      <AdminPageHeader
        title="Your Bluepass page"
        support={`We built it from ${claimed.name}'s website. Choose which of your photos travellers see, and check which Rezdy trip each trip books through.`}
        aside={claimed.pageLive ? <Link href={`/operators/${claimed.slug}`} target="_blank" className="ds-body-sm">See your page ↗</Link> : null}
      />
      {welcome === "1" && claimed.pageLive ? (
        <Link href={`/operators/${claimed.slug}`} target="_blank" className="adm-card op-prompt">
          <span className="ds-body">Your page is live. Thank you for claiming it.</span>
          <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>See it as travellers do ↗ Anything not quite right, correct it below.</span>
        </Link>
      ) : null}

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Photos</h2>
        </header>
        {!claimed.claimApproved ? (
          <p className="ds-body adm-card" style={{ padding: 20 }}>Your claim is still being checked. You can choose photos as soon as it is approved.</p>
        ) : claimed.photos.length === 0 ? (
          <p className="ds-body adm-card" style={{ padding: 20 }}>Your page has no photos yet.</p>
        ) : (
          <>
            <p className="ds-body-sm" style={{ color: "var(--color-ink-muted)", margin: "0 0 12px" }}>Untick any you would rather we did not show. Travellers see none until you save.</p>
            <PhotoChooser action={choosePhotosAction} photos={claimed.photos} chosenBefore={Boolean(claimed.approvedAt)} />
          </>
        )}
      </section>

      {loaded ? (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">What your page says</h2>
          </header>
          <p className="ds-body-sm" style={{ color: "var(--color-ink-muted)", margin: "0 0 12px" }}>
            Read from your website when we built the page. Correct anything that has changed; it shows on your page straight away.
          </p>
          <div className="adm-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
            <span className="ds-body">About {claimed.name}</span>
            <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>Summary, highlights and contact details</span>
            <FactEditor action={correctPageAction} fields={pageEditor(loaded)} label="Correct these details" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {loaded.trips.map((t) => (
              <div key={t.id} className="adm-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className="ds-body">{t.trip.title}</span>
                  <Link href={`/operators/${claimed.slug}/${t.slug}`} target="_blank" className="ds-caption" style={{ marginLeft: "auto" }}>View ↗</Link>
                </span>
                <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>
                  {[t.trip.duration, t.trip.season, t.trip.priceFrom ? `From ${t.trip.prices?.[0]?.currency === "USD" ? "US$" : "A$"}${t.trip.priceFrom}` : null].filter(Boolean).join(" · ") || "No times or prices yet"}
                </span>
                <FactEditor action={correctTripAction.bind(null, t.id)} fields={tripEditor(t)} label="Correct this trip" />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {booking ? (
        <section className="adm-block">
          <header className="adm-block__head">
            <h2 className="ds-headline adm-block__title">Booking on Bluepass</h2>
          </header>
          {!booking.connected ? (
            <Link href="/operator/connections" className="adm-card op-prompt">
              <span className="ds-body">Connect Rezdy to take bookings on your page</span>
              <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>Your trips match up by name and book at your own price, into your Rezdy. ›</span>
            </Link>
          ) : booking.products.length === 0 ? (
            <p className="ds-body adm-card" style={{ padding: 20 }}>Rezdy is connected, but is not sharing any trips with Bluepass yet. Give Bluepass a rate in Rezdy Marketplace and they appear here.</p>
          ) : (
            <>
              <p className="ds-body-sm" style={{ color: "var(--color-ink-muted)", margin: "0 0 12px" }}>
                {booking.trips.filter((t) => t.listingId).length} of {booking.trips.length} trips on your page book through Rezdy. Change any match that is wrong.
              </p>
              <BookingChooser action={chooseBookingAction} trips={booking.trips} products={booking.products} />
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
