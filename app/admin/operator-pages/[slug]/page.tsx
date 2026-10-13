import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import CheckControls from "@/components/admin/CheckControls";
import FactEditor, { type EditorField } from "@/components/admin/FactEditor";
import StatusPill from "@/components/admin/StatusPill";
import ApproveWaiting from "@/components/admin/ApproveWaiting";
import { approveWaitingTripsAction, checkPageAction, checkTripAction, editPageAction, editTripAction } from "@/app/admin/operator-pages/actions";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import type { LeftOutPhoto } from "@/lib/services/operators/photo-check";
import { PAGE_FIELDS, TRIP_FIELDS, fieldText, type TripEdits } from "@/lib/services/operators/prepared-edits";
import { loadPreparedPage, nextPageToCheck, type LoadedPage, type PreparedTrip } from "@/lib/services/operators/prepared-pages";
import { pageStaleSigns, staleSigns } from "@/lib/services/operators/stale-signs";

export const metadata = { title: "Check a prepared page · Bluepass Admin" };
export const dynamic = "force-dynamic";

const STATUS = {
  pending: { tone: "warn", label: "To check" },
  approved: { tone: "good", label: "Approved" },
  needs_fix: { tone: "bad", label: "Needs a fix" },
} as const;

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString("en-AU", { minimumFractionDigits: amount % 1 ? 2 : 0 })}`;
}

function Row({ label, children, was }: { label: string; children: ReactNode; was?: string | null }) {
  const empty = children === null || children === undefined || children === "" || (Array.isArray(children) && children.length === 0);
  if (empty && (was === undefined || was === null)) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, padding: "6px 0", borderTop: "1px solid var(--color-hairline-soft)" }}>
      <dt className="ds-micro" style={{ color: "var(--color-ink-muted)" }}>{label}</dt>
      <dd className="ds-body-sm" style={{ margin: 0 }}>
        {empty ? "Nothing" : children}
        {was !== undefined && was !== null ? (
          <span className="ds-caption" style={{ display: "block", marginTop: 4, color: "var(--color-gradient-orange)", whiteSpace: "pre-line" }}>Corrected. The website says: {was || "nothing"}</span>
        ) : null}
      </dd>
    </div>
  );
}

/** What the website says for a field that was corrected, or null when it was not. */
function wasFor(edits: Record<string, unknown> | null, website: object, name: string) {
  if (!edits || !(name in edits)) return null;
  const field = [...TRIP_FIELDS, ...PAGE_FIELDS].find((f) => f.name === name);
  return field ? fieldText(field.kind, (website as Record<string, unknown>)[name]) : null;
}

function tripEditor(t: LoadedPage["trips"][number]): EditorField[] {
  const shown = t.trip as unknown as Record<string, unknown>;
  return TRIP_FIELDS.map((f) => ({
    name: f.name, label: f.label, kind: f.kind, hint: f.hint,
    // The From price starts empty unless set by hand, so leaving it alone keeps it worked out.
    value: f.name === "priceFrom" ? fieldText("money", t.edits?.priceFrom) : fieldText(f.kind, shown[f.name]),
    website: wasFor(t.edits as Record<string, unknown> | null, t.website, f.name),
  }));
}

function pageEditor(loaded: LoadedPage): EditorField[] {
  const shown = { summary: loaded.page.summary, standouts: loaded.page.standouts, phone: loaded.page.contact?.phone, email: loaded.page.contact?.email, address: loaded.page.contact?.address };
  const website = { summary: loaded.website.summary, standouts: loaded.website.standouts, phone: loaded.website.contact?.phone, email: loaded.website.contact?.email, address: loaded.website.contact?.address };
  const edited = { ...loaded.edits, ...loaded.edits?.contact } as Record<string, unknown>;
  return PAGE_FIELDS.map((f) => ({
    name: f.name, label: f.label, kind: f.kind, hint: f.hint,
    value: fieldText(f.kind, (shown as Record<string, unknown>)[f.name]),
    website: loaded.edits ? wasFor(edited, website, f.name) : null,
  }));
}

function Thumbs({ urls }: { urls: string[] | undefined }) {
  if (!urls?.length) return <span style={{ color: "var(--color-gradient-orange)" }}>No photos found</span>;
  return (
    <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 8, background: "var(--color-surface-2)" }} />
        </a>
      ))}
    </span>
  );
}

function LeftOut({ photos }: { photos: LeftOutPhoto[] | undefined }) {
  if (!photos?.length) return null;
  return (
    <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {photos.map((p) => (
        <a key={p.url} href={p.url} target="_blank" rel="noreferrer" style={{ display: "flex", flexDirection: "column", gap: 4, width: 120 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt="" style={{ width: 120, height: 60, objectFit: "cover", borderRadius: 8, background: "var(--color-surface-2)", opacity: 0.6 }} />
          <span className="ds-micro" style={{ color: "var(--color-ink-muted)" }}>{p.reason}</span>
        </a>
      ))}
    </span>
  );
}

/** What the automatic checks found, above the researcher's own note. */
function OutOfDate({ signs }: { signs: string[] }) {
  if (!signs.length) return null;
  return (
    <ul className="ds-body-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--color-gradient-orange)" }}>
      {signs.map((sign) => <li key={sign}>Out of date? {sign}</li>)}
    </ul>
  );
}

function TripFacts({ t, website, edits }: { t: PreparedTrip; website: PreparedTrip; edits: TripEdits | null }) {
  const was = (name: string) => wasFor(edits as Record<string, unknown> | null, website, name);
  return (
    <dl style={{ margin: 0 }}>
      <Row label="Title" was={was("title")}>{edits && "title" in edits ? t.title : null}</Row>
      <Row label="Summary" was={was("summary")}>{t.summary}</Row>
      <Row label="Highlights" was={was("highlights")}>{t.highlights?.length ? t.highlights.join(" · ") : null}</Row>
      <Row label="Duration" was={was("duration")}>{t.duration ? `${t.duration}${t.durationMinutes ? ` (${t.durationMinutes} min)` : ""}` : null}</Row>
      <Row label="Departs" was={was("departureTimes")}>{t.departureTimes?.length ? t.departureTimes.join(", ") : null}</Row>
      <Row label="Season" was={was("season")}>{t.season}</Row>
      <Row label="Departs from" was={was("departsFrom")}>{t.departsFrom}</Row>
      <Row label="Prices" was={was("prices")}>
        {t.prices?.length
          ? t.prices.map((p) => `${p.label} ${money(p.amount, p.currency)}${p.note ? ` (${p.note})` : ""}`).join(" · ")
          : <span style={{ color: "var(--color-gradient-orange)" }}>No prices on the site</span>}
      </Row>
      <Row label="From" was={was("priceFrom")}>
        {t.priceFrom
          ? `${money(t.priceFrom, t.prices?.find((p) => p.label === t.priceFromLabel)?.currency ?? t.prices?.[0]?.currency ?? "AUD")}${t.priceFromLabel ? `, the "${t.priceFromLabel}" price` : ""}`
          : t.prices?.length ? <span style={{ color: "var(--color-gradient-orange)" }}>No adult price for the main activity, so no From price</span> : null}
      </Row>
      <Row label="Includes" was={was("includes")}>{t.includes?.length ? t.includes.join(" · ") : null}</Row>
      <Row label="Bring" was={was("bring")}>{t.bring?.length ? t.bring.join(" · ") : null}</Row>
      <Row label="Good to know" was={was("requirements")}>{t.requirements}</Row>
      <Row label="Offer">{t.offer ? `${t.offer.text}${t.offer.conditions ? `. ${t.offer.conditions}` : ""}${t.offer.validUntil ? ` (until ${t.offer.validUntil})` : ""}` : null}</Row>
      <Row label="Booking links" was={was("bookingLinks")}>{t.bookingLinks?.length ? t.bookingLinks.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer" style={{ display: "block", wordBreak: "break-all" }}>{l}</a>) : null}</Row>
      <Row label="Photos"><Thumbs urls={t.images} /></Row>
      <Row label="Left out">{t.photosLeftOut?.length ? <LeftOut photos={t.photosLeftOut} /> : null}</Row>
      <Row label="Not measured">{t.photosUnmeasured?.length ? `The site turns away automated checks, so ${t.photosUnmeasured.length === 1 ? "this photo was" : `these ${t.photosUnmeasured.length} photos were`} kept without measuring. Judge ${t.photosUnmeasured.length === 1 ? "it" : "them"} by eye above.` : null}</Row>
    </dl>
  );
}

/**
 * One prepared page, laid out for checking: every fact beside the operator's own page it
 * came from, the researcher's doubts flagged first, and a decision per trip.
 */
export default async function CheckPreparedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAdminOrRedirect(`/admin/operator-pages/${slug}`);
  const loaded = await loadPreparedPage(slug, { preview: true });
  if (!loaded) notFound();
  const { page, trips } = loaded;
  const next = await nextPageToCheck(slug);

  return (
    <>
      <p className="ds-caption" style={{ marginBottom: 8 }}><Link href="/admin/operator-pages">Prepared pages</Link> › {page.name}</p>
      <AdminPageHeader
        eyebrow={[page.town, page.state, page.category].filter(Boolean).join(" · ")}
        title={page.name}
        support={`${trips.length} trips read from ${page.website}. Check each against its source page, then approve the page.`}
        aside={
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <Link href={`/operators/${slug}?preview=1`} target="_blank" className="ds-body-sm">Preview the page ↗</Link>
            {next ? <Link href={`/admin/operator-pages/${next}`} className="ds-body-sm">Next page to check ›</Link> : null}
          </span>
        }
      />

      <section className="adm-block">
        <header className="adm-block__head" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <h2 className="ds-headline adm-block__title">The operator</h2>
          <StatusPill tone={STATUS[page.qcStatus].tone}>{STATUS[page.qcStatus].label}</StatusPill>
        </header>
        <div className="adm-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <OutOfDate signs={pageStaleSigns(page.offers)} />
          {page.checkNotes ? <p className="ds-body-sm" style={{ color: "var(--color-gradient-orange)" }}>Researcher&rsquo;s note: {page.checkNotes}</p> : null}
          <dl style={{ margin: 0 }}>
            <Row label="Summary" was={wasFor(loaded.edits as Record<string, unknown> | null, loaded.website, "summary")}>{page.summary}</Row>
            <Row label="Standouts" was={wasFor(loaded.edits as Record<string, unknown> | null, loaded.website, "standouts")}>{page.standouts?.length ? page.standouts.join(" · ") : null}</Row>
            <Row label="Contact" was={loaded.edits?.contact ? [loaded.website.contact?.phone, loaded.website.contact?.email, loaded.website.contact?.address].filter(Boolean).join(" · ") : null}>{[page.contact?.phone, page.contact?.email, page.contact?.address].filter(Boolean).join(" · ") || null}</Row>
            <Row label="Rezdy">{page.rezdyAlias ? `${page.rezdyAlias}.rezdy.com` : null}</Row>
            <Row label="Offers">{page.offers?.length ? page.offers.map((o) => `${o.text}${o.conditions ? ` (${o.conditions})` : ""}`).join(" · ") : null}</Row>
            <Row label="Hero photo"><Thumbs urls={page.heroImage ? [page.heroImage] : []} /></Row>
            <Row label="Photo approval">
              {loaded.photos.approvedAt
                ? `${loaded.photos.approvedBy ?? "The operator"} approved ${loaded.photos.approved.length} on ${loaded.photos.approvedAt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}. Travellers see only those.`
                : "Linked from the operator's website. Travellers see none until the operator approves them after claiming the page."}
            </Row>
            <Row label="Left out">{page.photosLeftOut?.length ? <LeftOut photos={page.photosLeftOut} /> : null}</Row>
            <Row label="Pages read">{page.sourceUrls?.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" style={{ display: "block", wordBreak: "break-all" }}>{u}</a>)}</Row>
          </dl>
          <FactEditor action={editPageAction.bind(null, slug)} fields={pageEditor(loaded)} label="Correct the operator details" />
          <CheckControls action={checkPageAction.bind(null, slug)} status={page.qcStatus} notes={page.qcNotes} approveLabel="Approve the page" />
        </div>
      </section>

      <section className="adm-block">
        <header className="adm-block__head" style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 className="ds-headline adm-block__title">Trips</h2>
          <ApproveWaiting action={approveWaitingTripsAction.bind(null, slug)} waiting={trips.filter((t) => t.check.status === "pending").length} />
        </header>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {trips.map((t) => {
            const { id, check, trip } = t;
            return (
            <article key={id} className="adm-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <header style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <h3 className="ds-body-lg" style={{ margin: 0 }}>{trip.title}</h3>
                <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>{trip.kind}</span>
                <StatusPill tone={STATUS[check.status].tone}>{STATUS[check.status].label}</StatusPill>
                <a href={trip.sourceUrl} target="_blank" rel="noreferrer" className="ds-caption" style={{ marginLeft: "auto" }}>Source page ↗</a>
              </header>
              <OutOfDate signs={staleSigns(trip)} />
              {trip.checkNotes ? <p className="ds-body-sm" style={{ color: "var(--color-gradient-orange)", margin: 0 }}>Researcher&rsquo;s note: {trip.checkNotes}</p> : null}
              <TripFacts t={trip} website={t.website} edits={t.edits} />
              <FactEditor action={editTripAction.bind(null, id, slug)} fields={tripEditor(t)} />
              <CheckControls action={checkTripAction.bind(null, id, slug)} status={check.status} notes={check.notes} />
            </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
