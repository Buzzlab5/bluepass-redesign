import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import ConfirmEmailForm from "@/components/admin/ConfirmEmailForm";
import "@/app/creators.css";
import { confirmEmailAction } from "@/app/admin/visits/actions";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { barbadosVisits } from "@/lib/services/operators/visits";

export const metadata = { title: "Visit · Bluepass Admin" };
export const dynamic = "force-dynamic";

/**
 * One operator, for the visit itself: the claim code on a white tile big enough to scan
 * from a phone held out, their page to show them, and their business email to confirm.
 */
export default async function VisitSheet({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAdminOrRedirect(`/admin/visits/${slug}`);
  const stops = await barbadosVisits();
  const i = stops.findIndex((s) => s.slug === slug);
  if (i < 0) notFound();
  const s = stops[i];
  const next = stops.slice(i + 1).find((n) => !n.claimed) ?? null;
  const raise = s.flags.filter((f) => f !== "no email on file");
  // The code is drawn on the server from the library's own SVG: nothing a visitor typed is in it.
  const qr = await QRCode.toString(s.claimUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f0f0f", light: "#ffffff" } });

  return (
    <div className="vi-sheet">
      <p className="ds-caption"><Link href="/admin/visits">Visits</Link> › {s.town}</p>
      <h1 className="ds-headline vi-sheet__name">{s.name}</h1>
      <p className="ou-muted vi-sheet__sub">
        {[s.category, s.page === "full" ? `${s.trips} ${s.trips === 1 ? "trip" : "trips"}${s.fromPrice ? `, from ${s.fromPrice}` : ""}` : "Claim page only", s.claimed ? "Claimed" : null].filter(Boolean).join(" · ")}
      </p>

      {s.claimed ? (
        <p className="ds-body adm-card" style={{ padding: 20 }}>They have claimed their page. Nothing to do here.</p>
      ) : (
        <>
          <figure className="vi-qr">
            <div className="vi-qr__tile" dangerouslySetInnerHTML={{ __html: qr }} />
            <figcaption>
              {s.email
                ? <>Ask them to scan this. The claim link goes to <strong>{s.email}</strong>; they open it on their phone and claim in one press.</>
                : <>We hold no business email for them yet. Take it below first, then ask them to scan this.</>}
            </figcaption>
          </figure>
          <ConfirmEmailForm slug={s.slug} current={s.email} action={confirmEmailAction} />
        </>
      )}

      <div className="vi-actions">
        {s.page === "full" ? <a className="bpe__btn" href={`/operators/${s.slug}?preview=1`} target="_blank" rel="noreferrer">Show them their page ↗</a> : null}
        {s.phone ? <a className="bpe__btn" href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}>Call {s.phone}</a> : null}
        {s.whatsapp ? <a className="bpe__btn" href={s.whatsapp} target="_blank" rel="noreferrer">WhatsApp ↗</a> : null}
      </div>

      {raise.length ? <p className="ou-muted vi-sheet__flags">To raise with them: {raise.join(", ")}.</p> : null}
      {s.checked === "to check" ? <p className="ou-muted">Their page has not been checked yet, so it is not public; they still see it when they claim.</p> : null}

      {next ? <p className="ds-body-sm"><Link href={`/admin/visits/${next.slug}`}>Next: {next.name}, {next.town} ›</Link></p> : null}
    </div>
  );
}
