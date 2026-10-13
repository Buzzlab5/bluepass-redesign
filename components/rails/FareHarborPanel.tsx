"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/services/rails/money";

type Lightframe = Record<string, unknown>;
type FareHarborApi = { open: (options: Lightframe) => boolean };

function fh() {
  return (window as unknown as { FH?: FareHarborApi }).FH;
}

/**
 * The booking card for a trip that books on the operator's FareHarbor. FareHarbor
 * gives affiliates no live data, so Bluepass shows no calendar of its own: the
 * operator's checkout opens over the page in FareHarbor's Lightframe, with Bluepass's
 * affiliate tag and a reference of its own, and FareHarbor takes it from there.
 *
 * The button is a real link to a redirect that records the hand-off, so it works
 * without script, inside an operator's iframe and through popup blockers alike. With
 * script, the click opens the Lightframe instead.
 */
export default function FareHarborPanel({
  slug,
  title,
  operatorName,
  fromCents,
  currency,
  embed = false,
}: {
  slug: string;
  title?: string;
  operatorName: string;
  fromCents: number | null;
  currency: string;
  embed?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const href = `/api/rails/${slug}/handoff?go=1`;

  useEffect(() => {
    if (embed || fh() || document.querySelector("script[data-fareharbor]")) return;
    const script = document.createElement("script");
    script.src = "https://fareharbor.com/embeds/api/v1/";
    script.async = true;
    script.dataset.fareharbor = "1";
    document.head.appendChild(script);
  }, [embed]);

  async function open(e: React.MouseEvent<HTMLAnchorElement>) {
    if (embed || !fh() || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/rails/${slug}/handoff`, { method: "POST" });
      const data = (await res.json()) as { url?: string; lightframe?: Lightframe };
      if (!res.ok || !data.url) throw new Error();
      // FareHarbor sends phones to its full-page checkout instead of the overlay.
      if (!data.lightframe || !fh()?.open(data.lightframe)) window.location.assign(data.url);
    } catch {
      window.location.assign(href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`bk-panel${embed ? " bk-panel--embed" : ""}`}>
      <header className="bk-panel__head">
        {embed && title ? <p className="ds-body bk-panel__title">{title}</p> : null}
        {fromCents !== null ? (
          <p className="bk-panel__price">
            <span className="ds-micro bk-muted">From</span>{" "}
            <span className="ds-headline">{formatMoney(fromCents, currency)}</span>{" "}
            <span className="ds-caption bk-muted">per guest</span>
          </p>
        ) : null}
      </header>
      <section className="bk-section">
        <p className="ds-body-sm">Dates, prices and payment are on {operatorName}&rsquo;s own booking page. It opens right here.</p>
        <a href={href} className="bk-cta" onClick={open} rel="nofollow" target={embed ? "_blank" : undefined} aria-busy={busy}>
          {busy ? "Opening…" : "Check dates and book"}
        </a>
        <p className="ds-micro bk-reef">A fixed 5% of your fare protects the reef you visit.</p>
      </section>
      <footer className="bk-panel__foot ds-micro bk-muted">
        Booked and paid with {operatorName} through FareHarbor, their booking system. Their terms and refunds apply.
      </footer>
    </div>
  );
}
