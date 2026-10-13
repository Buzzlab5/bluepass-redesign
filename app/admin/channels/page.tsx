import AdminPageHeader from "@/components/admin/AdminPageHeader";
import FareHarborReportImport, { RunChannelSync } from "@/components/admin/FareHarborReportImport";
import StatusPill from "@/components/admin/StatusPill";
import { prisma } from "@/lib/db/prisma";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { fareHarborAffiliate } from "@/lib/services/channels/fareharbor/links";
import { rezdyConfig } from "@/lib/services/channels/rezdy/api";
import { formatMoney } from "@/lib/services/rails/money";

export const metadata = { title: "Rezdy & FareHarbor · Bluepass Admin" };

function ago(date: Date | null) {
  if (!date) return "never";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/**
 * Bluepass's side of the two booking-system channels: whether each operator's Rezdy
 * connection is healthy, and FareHarbor's affiliate report, which is the only way
 * FareHarbor bookings reach Bluepass at all.
 */
export default async function ChannelsAdminPage() {
  await requireAdminOrRedirect("/admin/channels");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [connections, handoffs, fhBookings, lastRun] = await Promise.all([
    prisma.operatorChannelConnection.findMany({
      orderBy: [{ platform: "asc" }, { status: "asc" }, { updatedAt: "desc" }],
      include: { operatorProfile: { select: { companyName: true, _count: { select: { listings: true } } } } },
    }),
    prisma.channelHandoff.count({ where: { channel: "FAREHARBOR", createdAt: { gte: since } } }),
    prisma.listingBooking.groupBy({
      by: ["currency"],
      where: { channel: "FAREHARBOR", status: "CONFIRMED", createdAt: { gte: since } },
      _sum: { totalCents: true, commissionCents: true, conservationCents: true },
      _count: true,
    }),
    prisma.cronRunLog.findFirst({ where: { jobName: "channel-sync" }, orderBy: { startedAt: "desc" } }).catch(() => null),
  ]);
  const rezdy = connections.filter((c) => c.platform === "REZDY");
  const fareHarbor = connections.filter((c) => c.platform === "FAREHARBOR");
  const tone = (s: string) => (s === "CONNECTED" ? "good" : s === "WAITING" ? "warn" : "bad");

  return (
    <>
      <AdminPageHeader
        eyebrow="Channels"
        title="Rezdy & FareHarbor"
        support="Operators who sell from their own booking system. Rezdy runs itself every 15 minutes; FareHarbor bookings arrive only when its affiliate report is imported here."
      />

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">Rezdy</h2>
          <p className="ds-caption adm-block__note">
            {rezdyConfig() ? `Agent key set. Last automatic run ${ago(lastRun?.startedAt ?? null)}.` : "REZDY_API_KEY is not set, so Rezdy trips cannot be read or booked."}
          </p>
        </header>
        <div className="adm-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {rezdy.length === 0 ? <p className="ds-body-sm">No operator has connected Rezdy yet.</p> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {rezdy.map((c) => (
                <li key={c.id} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                  <StatusPill tone={tone(c.status)}>{c.status === "CONNECTED" ? "Connected" : c.status === "WAITING" ? "Waiting for trips" : "Broken"}</StatusPill>
                  <span className="ds-body-sm">{c.operatorProfile.companyName ?? c.displayName} · {c.accountKey}.rezdy.com</span>
                  <span className="ds-caption">checked {ago(c.lastCheckedAt)}{c.lastError ? ` · ${c.lastError}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {rezdyConfig() ? <RunChannelSync /> : null}
        </div>
      </section>

      <section className="adm-block">
        <header className="adm-block__head">
          <h2 className="ds-headline adm-block__title">FareHarbor</h2>
          <p className="ds-caption adm-block__note">
            {fareHarborAffiliate()
              ? `Affiliate shortname "${fareHarborAffiliate()}". ${fareHarbor.length} ${fareHarbor.length === 1 ? "operator" : "operators"} connected, ${handoffs} ${handoffs === 1 ? "traveller" : "travellers"} sent to FareHarbor in the last 30 days.`
              : "FAREHARBOR_AFFILIATE_SHORTNAME is not set, so FareHarbor trips do not sell."}
          </p>
        </header>
        {fhBookings.length ? (
          <div className="adm-card" style={{ padding: 20, marginBottom: 14 }}>
            {fhBookings.map((g) => (
              <p key={g.currency} className="ds-body-sm">
                Last 30 days, imported: {g._count} bookings, {formatMoney(g._sum.totalCents ?? 0, g.currency)} in fares,{" "}
                {formatMoney(g._sum.commissionCents ?? 0, g.currency)} commission owed to Bluepass by the operators,{" "}
                {formatMoney(g._sum.conservationCents ?? 0, g.currency)} owed to the reef.
              </p>
            ))}
          </div>
        ) : null}
        <FareHarborReportImport />
      </section>
    </>
  );
}
