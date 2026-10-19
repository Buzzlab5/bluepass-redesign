import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill from "@/components/admin/StatusPill";
import FilterPillLabel from "@/components/crm/FilterPillLabel";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { inRegion, PAGE_REGIONS, preparedPagesOverview } from "@/lib/services/operators/prepared-pages";

export const metadata = { title: "Prepared pages · Bluepass Admin" };
export const dynamic = "force-dynamic";

const PAGE_STATUS = {
  pending: { tone: "warn", label: "To check" },
  approved: { tone: "good", label: "Approved" },
  needs_fix: { tone: "bad", label: "Needs a fix" },
} as const;

type Overview = Awaited<ReturnType<typeof preparedPagesOverview>>;

const LABEL = Object.fromEntries(PAGE_REGIONS.map((r) => [r.key, r.label])) as Record<string, string>;
const ORDER = PAGE_REGIONS.map((r) => r.key as string);

/** All regions: one group per region. One region: one group per town, so a long list reads like a map. */
function groups(pages: Overview, region: string | null) {
  const by = new Map<string, Overview>();
  for (const p of pages) {
    const key = region ? p.town ?? "Town not stated" : p.region ?? "other";
    by.set(key, [...(by.get(key) ?? []), p]);
  }
  const keys = [...by.keys()].sort((a, b) =>
    region
      ? Number(a === "Town not stated") - Number(b === "Town not stated") || a.localeCompare(b)
      : (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)),
  );
  return keys.map((key) => ({ key, title: region ? key : LABEL[key] ?? "Region not stated", pages: by.get(key)! }));
}

/** One row of region links; scrolls sideways rather than running off a phone screen. */
function Pills({ label, options, active }: { label: string; options: { key: string | null; text: string }[]; active: string | null }) {
  return (
    <div className="crm-filter" role="group" aria-label={label} style={{ marginBottom: 12, maxWidth: "100%" }}>
      <span className="ds-micro crm-filter__label">{label}</span>
      <div className="adm-filter__options" style={{ maxWidth: "100%", overflowX: "auto" }}>
        {options.map((o) => (
          <Link key={o.key ?? "all"} href={o.key ? `/admin/operator-pages?region=${o.key}` : "/admin/operator-pages"} scroll={false} className={`ds-body-sm adm-filter__option ${active === o.key ? "is-active" : ""}`} aria-current={active === o.key ? "true" : undefined}>
            <FilterPillLabel>{o.text}</FilterPillLabel>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * The checking queue for operator pages prepared from operators' own websites. Nothing
 * on them reaches a traveller until it is approved here, trip by trip. Walked by region:
 * Barbados, or Australia state by state.
 */
export default async function PreparedPagesAdmin({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  await requireAdminOrRedirect("/admin/operator-pages");
  const [all, query] = await Promise.all([preparedPagesOverview(), searchParams]);
  const region = PAGE_REGIONS.some((r) => r.key === query.region) ? query.region! : null;
  const pages = all.filter((p) => inRegion(p.region, region));
  const totals = pages.reduce((t, p) => ({ trips: t.trips + p.trips, approved: t.approved + p.approved }), { trips: 0, approved: 0 });
  const counts = PAGE_REGIONS.map((r) => ({ ...r, count: all.filter((p) => inRegion(p.region, r.key)).length })).filter((r) => r.count > 0);
  const suffix = region ? `?region=${region}` : "";
  const inAustralia = region === "australia" || PAGE_REGIONS.some((r) => r.key === region && "short" in r);

  return (
    <>
      <AdminPageHeader
        title="Prepared pages"
        support={all.length
          ? `${region ? `${LABEL[region]}: ` : ""}${pages.length} operators, ${totals.trips} trips, ${totals.approved} approved. Every fact was read from the operator's own website; check it against the source page linked beside it.`
          : "Nothing imported yet. Run scripts/import-operator-pages.ts."}
      />

      {all.length ? (
        <>
          <Pills label="Region" options={[{ key: null, text: `All · ${all.length}` }, ...counts.filter((r) => !("short" in r)).map((r) => ({ key: r.key, text: `${r.label} · ${r.count}` }))]} active={inAustralia ? "australia" : region} />
          {inAustralia ? (
            <Pills label="State" options={counts.filter((r) => "short" in r).map((r) => ({ key: r.key, text: `${(r as { short: string }).short} · ${r.count}` }))} active={region} />
          ) : null}
        </>
      ) : null}

      {groups(pages, region).map((g) => (
        <section key={g.key} style={{ marginBottom: 20 }}>
          <h2 className="ds-micro" style={{ margin: "0 0 8px", color: "var(--color-ink-muted)" }}>{g.title} · {g.pages.length}</h2>
          <div className="adm-card" style={{ padding: 0 }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {g.pages.map((p, i) => (
                <li key={p.slug} style={i ? { borderTop: "1px solid var(--color-hairline)" } : undefined}>
                  <Link href={`/admin/operator-pages/${p.slug}${suffix}`} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, alignItems: "center", padding: "14px 20px", textDecoration: "none", color: "inherit" }}>
                    <span>
                      <span className="ds-body" style={{ display: "block" }}>{p.name}</span>
                      <span className="ds-caption" style={{ color: "var(--color-ink-muted)" }}>
                        {p.where} · {p.approved} of {p.trips} {p.trips === 1 ? "trip" : "trips"} approved{p.needsFix ? ` · ${p.needsFix} need a fix` : ""}{p.flags.length ? ` · ${p.flags.join(", ")}` : ""}
                      </span>
                    </span>
                    <StatusPill tone={PAGE_STATUS[p.qcStatus].tone}>{PAGE_STATUS[p.qcStatus].label}</StatusPill>
                    <span aria-hidden>›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </>
  );
}
