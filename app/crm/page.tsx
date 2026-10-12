import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import StatusPill, { type PillTone } from "@/components/admin/StatusPill";
import FilterPillLabel from "@/components/crm/FilterPillLabel";
import LeadCategorySelect from "@/components/crm/LeadCategorySelect";
import LeadSearchField from "@/components/crm/LeadSearchField";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { BD_STATUS_LABELS } from "@/lib/services/admin/lead-outreach";
import {
  buildLeadsHref,
  buildOperatorOutreachPaginationItems,
  loadOperatorOutreachList,
} from "@/lib/services/operators/operator-outreach-list";

export const metadata = { title: "Operator leads · Bluepass CRM" };

const STATUS_TONES: Record<string, PillTone> = {
  IMPORTED: "muted",
  CONTACTED: "warn",
  CLAIM_LINK_REQUESTED: "warn",
  IN_DISCUSSION: "warn",
  CLAIM_SUBMITTED: "warn",
  MANUAL_REVIEW: "warn",
  APPROVED: "good",
  LIVE: "good",
  DECLINED: "bad",
};

function statusLabel(status: string) {
  return BD_STATUS_LABELS[status as keyof typeof BD_STATUS_LABELS] ?? status.replace(/_/g, " ");
}

function formatSource(source: string) {
  if (source === "rezdy-scrape") return "Rezdy";
  if (source === "fareharbor-scrape") return "FareHarbor";
  return source;
}

/* Filter, search and page all live in the query string rather than component state: the whole point
   of this page is that someone working a call list can send a colleague the exact view they are
   looking at, and come back to it tomorrow on the same URL. */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; source?: string; category?: string; q?: string; page?: string }>;
}) {
  await requireAdminOrRedirect("/crm");

  const params = await searchParams;
  const list = await loadOperatorOutreachList({
    filter: params.filter,
    source: params.source,
    category: params.category,
    q: params.q ?? "",
    page: params.page ?? "1",
  });

  const buildHref = (next: {
    filter?: string;
    source?: string;
    category?: string;
    q?: string;
    page?: number | string;
  }) =>
    buildLeadsHref({
      filter: next.filter ?? list.activeFilter,
      source: next.source ?? list.activeSource,
      category: next.category ?? list.activeCategory,
      q: next.q ?? list.search,
      page: next.page ?? 1,
    });

  return (
    <>
      <AdminPageHeader
        title="Operator leads"
        support={`${list.totals.all} lead${list.totals.all === 1 ? "" : "s"} in the pipeline — ${list.totals.needsOutreach} still untouched, ${list.totals.contacted} contacted, ${list.totals.inDiscussion} in discussion, ${list.totals.approved} signed.`}
      />

      <div className="crm-filter-row crm-filter-row--tight">
        <div className="crm-filter" role="group" aria-label="Lead market filter">
          <span className="ds-micro crm-filter__label">Market</span>
          <div className="adm-filter__options">
            {list.sourceOptions.map((option) => (
              <Link
                key={option.key}
                href={buildHref({ source: option.key, page: 1 })}
                className={`ds-body-sm adm-filter__option ${option.key === list.activeSource ? "is-active" : ""}`}
                aria-current={option.key === list.activeSource ? "true" : undefined}
                scroll={false}
              >
                <FilterPillLabel>{option.label}</FilterPillLabel>
              </Link>
            ))}
          </div>
        </div>

        <div className="crm-filter-row__search">
          <LeadSearchField
            defaultValue={list.search}
            filter={list.activeFilter}
            source={list.activeSource}
            category={list.activeCategory}
          />
        </div>
      </div>

      <div className="crm-filter-row">
        <div className="crm-filter" role="group" aria-label="Lead stage filter">
          <span className="ds-micro crm-filter__label">Stage</span>
          <div className="adm-filter__options">
            {list.filterOptions.map((option) => (
              <Link
                key={option.key}
                href={buildHref({ filter: option.key, page: 1 })}
                className={`ds-body-sm adm-filter__option ${option.key === list.activeFilter ? "is-active" : ""}`}
                aria-current={option.key === list.activeFilter ? "true" : undefined}
                scroll={false}
              >
                <FilterPillLabel>{option.label}</FilterPillLabel>
              </Link>
            ))}
          </div>
        </div>

        <div className="crm-filter crm-filter-row__trailing" role="group" aria-label="Lead category filter">
          <span className="ds-micro crm-filter__label">Category</span>
          <LeadCategorySelect
            options={list.categoryOptions}
            value={list.activeCategory}
            filter={list.activeFilter}
            source={list.activeSource}
            q={list.search}
          />
        </div>
      </div>

      {list.leads.length === 0 ? (
        <div className="adm-card adm-empty">
          <p className="ds-body-sm adm-empty__body">No leads match this view.</p>
        </div>
      ) : (
        <>
          {/* `adm-table--cards` is what lets the same markup become a stacked card list on a phone.
              Every cell carries its own `data-label` so the CSS can print the column heading next
              to the value once the <thead> is gone — see the .adm-table--cards block in
              globals.css. This page is worked from a phone more than any other in the console
              (it is a call list), so the mobile layout is not a courtesy here. */}
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--cards">
              <thead>
                <tr>
                  <th className="ds-micro">Business</th>
                  <th className="ds-micro">Status</th>
                  <th className="ds-micro">Category</th>
                  <th className="ds-micro">Location</th>
                  <th className="ds-micro">Phone</th>
                  <th className="ds-micro">Source</th>
                  <th className="ds-micro">Last contact</th>
                  <th className="ds-micro"></th>
                </tr>
              </thead>
              <tbody>
                {list.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="ds-body-sm crm-cell--name">{lead.name}</td>
                    <td data-label="Status">
                      <StatusPill tone={STATUS_TONES[lead.status] ?? "muted"}>
                        {statusLabel(lead.status)}
                      </StatusPill>
                    </td>
                    <td className="ds-body-sm adm-table__nowrap" data-label="Category">{lead.category ?? "—"}</td>
                    <td className="ds-body-sm adm-table__nowrap" data-label="Location">{lead.region ?? "—"}</td>
                    <td className="ds-body-sm adm-table__num" data-label="Phone">
                      {lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : "—"}
                    </td>
                    <td className="ds-body-sm adm-table__nowrap" data-label="Source">{formatSource(lead.source)}</td>
                    <td className="ds-body-sm adm-table__num" data-label="Last contact">
                      {lead.lastOutreachAt ? lead.lastOutreachAt.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td className="ds-body-sm crm-cell--go">
                      <Link href={`/crm/${lead.id}`}>Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {list.totalPages > 1 ? (
            <nav className="adm-pagination" aria-label="Pagination">
              <span className="ds-micro adm-pagination__label">
                Page {list.page} of {list.totalPages}
              </span>
              {buildOperatorOutreachPaginationItems(list.page, list.totalPages).map((item, index) =>
                item === "ellipsis" ? (
                  <span key={`gap-${index}`} className="ds-body-sm adm-pagination__gap" aria-hidden>
                    …
                  </span>
                ) : (
                  <Link
                    key={item}
                    href={buildHref({ page: item })}
                    className={`ds-body-sm adm-pill ${item === list.page ? "adm-pill--live" : ""}`}
                    aria-current={item === list.page ? "page" : undefined}
                    scroll={false}
                  >
                    <FilterPillLabel>{item}</FilterPillLabel>
                  </Link>
                ),
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
