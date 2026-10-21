import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import "@/app/creators.css";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { barbadosVisits, type VisitStop } from "@/lib/services/operators/visits";

export const metadata = { title: "Visits · Bluepass Admin" };
export const dynamic = "force-dynamic";

function byTown(stops: VisitStop[]) {
  const towns = new Map<string, VisitStop[]>();
  for (const s of stops) towns.set(s.town, [...(towns.get(s.town) ?? []), s]);
  return [...towns.entries()];
}

/**
 * Barbados operators, by town, for a person going round in person: who has a full page,
 * who still needs a business email, and who has claimed. Each opens a sheet with the
 * claim code to scan.
 */
export default async function VisitsAdmin() {
  await requireAdminOrRedirect("/admin/visits");
  const stops = await barbadosVisits();
  const claimed = stops.filter((s) => s.claimed).length;
  const noEmail = stops.filter((s) => !s.email && !s.claimed).length;

  return (
    <>
      <AdminPageHeader
        title="Visits"
        support={`Barbados: ${stops.length} operators, ${claimed} claimed. ${noEmail} still need a business email, which you can take in person.`}
      />
      {byTown(stops).map(([town, list]) => (
        <section key={town} className="vi-town">
          <h2 className="ds-micro vi-town__title">{town} · {list.length}</h2>
          <ul className="ob-picks__list">
            {list.map((s) => (
              <li key={s.slug} className="ob-pick">
                <Link href={`/admin/visits/${s.slug}`} className="vi-row">
                  <span className="ob-pick__body">
                    <span className="ob-pick__name">{s.name}</span>
                    <span className="ob-pick__state">
                      {s.page === "full" ? `${s.trips} ${s.trips === 1 ? "trip" : "trips"}${s.fromPrice ? `, from ${s.fromPrice}` : ""}` : "Claim page only"}
                      {s.checked === "to check" ? " · page not checked yet" : ""}
                    </span>
                    {s.flags.length ? <span className="vi-flags">{s.flags.map((f) => <span key={f} className="vi-flag">{f}</span>)}</span> : null}
                  </span>
                  <span className={s.claimed ? "vi-status is-claimed" : "vi-status"}>{s.claimed ? "Claimed" : "Not yet"}</span>
                  <span aria-hidden>›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
