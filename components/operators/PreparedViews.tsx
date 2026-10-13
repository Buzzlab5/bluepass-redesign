import Link from "next/link";
import type { LoadedPage, PreparedTrip } from "@/lib/services/operators/prepared-pages";
import { cssImage } from "@/lib/services/rails/format";

/**
 * The public face of a prepared operator page: who they are and every trip they run, in
 * Bluepass's words with the operator's own facts. It says plainly that the operator has
 * not confirmed it, and books nothing itself: until the operator connects, the booking
 * button is theirs.
 */

function money(amount: number, currency: string) {
  const symbol = currency === "AUD" ? "A$" : currency === "USD" ? "US$" : `${currency} `;
  return `${symbol}${amount.toLocaleString("en-AU", { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function fromText(t: PreparedTrip) {
  if (!t.priceFrom) return null;
  return `From ${money(t.priceFrom, t.prices?.find((p) => p.label === t.priceFromLabel)?.currency ?? t.prices?.[0]?.currency ?? "AUD")}`;
}

/** "per adult" only when the From price is an adult's fare; a charter's price is for the boat. */
function perWhom(t: PreparedTrip) {
  const label = t.priceFromLabel ?? "";
  if (/\badults?\b/i.test(label)) return "per adult";
  if (/per (person|guest|head)|\bpp\b/i.test(label)) return "per person";
  return null;
}

/** A bookable trip's From price is Rezdy's, the price the traveller will actually pay. */
function liveFrom(b: { priceFrom: number | null; currency: string }) {
  return b.priceFrom ? `From ${money(b.priceFrom, b.currency)}` : null;
}

function websiteHref(url: string) {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

export function PreviewBanner({ data, status }: { data: LoadedPage; status: string }) {
  const approved = data.photos.approved.length;
  return (
    <p className="op-preview">
      Preview for checking. {status === "approved" ? "This page is approved; travellers see only its approved trips." : "Travellers cannot see this page until it is approved."}{" "}
      {data.photos.approvedAt
        ? `The operator approved ${approved} ${approved === 1 ? "photo" : "photos"}; travellers see only those.`
        : "Photos show here for checking; travellers see none until the operator approves them after claiming the page."}{" "}
      <Link href={`/admin/operator-pages/${data.slug}`}>Back to checking ›</Link>
    </p>
  );
}

export function PreparedOperatorView({ data, preview }: { data: LoadedPage; preview: boolean }) {
  const { page, trips, slug } = data;
  const where = [page.town, page.state].filter(Boolean).join(", ");
  return (
    <main className="bk theme-light">
      <header className="bk-hero" style={page.heroImage ? { backgroundImage: cssImage(page.heroImage) } : undefined}>
        <div className="bk-hero__shade" />
        <div className="bk-hero__copy">
          <p className="ds-micro bk-hero__eyebrow">{[where, page.category].filter(Boolean).join(" · ")}</p>
          <h1 className="ds-display-lg bk-hero__title">{page.name}</h1>
        </div>
      </header>

      <div className="op-wrap">
        {preview ? <PreviewBanner data={data} status={page.qcStatus} /> : null}
        {!data.lead.claimed ? (
          <p className="ds-body-sm op-notice">
            Bluepass prepared this page from {page.name}&rsquo;s own website. {page.name} has not confirmed it yet, so check prices and times with them when you book.
          </p>
        ) : null}

        <section className="op-intro">
          <p className="ds-body-lg">{page.summary}</p>
          {page.standouts?.length ? (
            <ul className="op-ticks">{page.standouts.map((s) => <li key={s} className="ds-body-sm">{s}</li>)}</ul>
          ) : null}
        </section>

        <section className="op-section" aria-label="Trips">
          <h2 className="ds-micro bk-about__label">{trips.length === 1 ? "The trip" : `${trips.length} trips`}</h2>
          <ul className="op-cards">
            {trips.map(({ slug: tripSlug, trip, check, bookable }) => {
              const image = trip.images?.[0] ?? page.heroImage ?? null;
              return (
                <li key={tripSlug}>
                  <Link href={`/operators/${slug}/${tripSlug}${preview ? "?preview=1" : ""}`} className="op-card">
                    {image ? <span className="op-card__img" style={{ backgroundImage: cssImage(image) }} aria-hidden /> : null}
                    <span className="op-card__body">
                      <span className="ds-micro op-card__kind">{[trip.kind, trip.duration].filter(Boolean).join(" · ")}</span>
                      <span className="ds-body op-card__title">{trip.title}</span>
                      <span className="ds-caption op-card__meta">{[bookable ? liveFrom(bookable) : fromText(trip), trip.season].filter(Boolean).join(" · ")}</span>
                      {bookable ? <span className="ds-micro op-card__offer">Book now</span> : trip.offer ? <span className="ds-micro op-card__offer">Offer</span> : null}
                      {preview && check.status !== "approved" ? <span className="ds-micro op-card__check">{check.status === "needs_fix" ? "Needs a fix" : "Not yet approved"}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {page.offers?.length ? (
          <section className="op-section" aria-label="Offers">
            <h2 className="ds-micro bk-about__label">Offers</h2>
            <ul className="op-offers">
              {page.offers.map((o) => (
                <li key={o.text} className="op-offer">
                  <span className="ds-body-sm">{o.text}</span>
                  {o.conditions || o.validUntil ? <span className="ds-caption bk-muted">{[o.conditions, o.validUntil ? `Until ${o.validUntil}` : null].filter(Boolean).join(" · ")}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="op-section op-contact">
          <a href={websiteHref(page.website)} className="bk-cta" target="_blank" rel="nofollow noopener noreferrer">Book with {page.name}</a>
          <p className="ds-caption bk-muted">
            {[page.contact?.phone, page.contact?.email].filter(Boolean).join(" · ")}
          </p>
        </section>
      </div>
    </main>
  );
}

export function PreparedTripView({ data, tripSlug, preview }: { data: LoadedPage; tripSlug: string; preview: boolean }) {
  const { page, slug } = data;
  const found = data.trips.find((t) => t.slug === tripSlug);
  if (!found) return null;
  const t = found.trip;
  const image = t.images?.[0] ?? page.heroImage ?? null;
  const book = t.bookingLinks?.[0] ?? websiteHref(page.website);
  const where = [page.town, page.state].filter(Boolean).join(", ");
  return (
    <main className="bk theme-light">
      <header className="bk-hero" style={image ? { backgroundImage: cssImage(image) } : undefined}>
        <div className="bk-hero__shade" />
        <div className="bk-hero__copy">
          <p className="ds-micro bk-hero__eyebrow">{[page.name, where].filter(Boolean).join(" · ")}</p>
          <h1 className="ds-display-lg bk-hero__title">{t.title}</h1>
        </div>
      </header>

      <div className="bk-grid">
        <article className="bk-about">
          {preview ? <PreviewBanner data={data} status={found.check.status} /> : null}
          <dl className="bk-facts">
            {t.duration ? <div><dt className="ds-micro">Length</dt><dd className="ds-body-sm">{t.duration}</dd></div> : null}
            {t.departureTimes?.length ? <div><dt className="ds-micro">Departs</dt><dd className="ds-body-sm">{t.departureTimes.join(", ")}</dd></div> : null}
            {t.season ? <div><dt className="ds-micro">Season</dt><dd className="ds-body-sm">{t.season}</dd></div> : null}
            {t.departsFrom ? <div><dt className="ds-micro">Meet at</dt><dd className="ds-body-sm">{t.departsFrom}</dd></div> : null}
          </dl>
          <p className="ds-body-lg bk-about__p">{t.summary}</p>
          {t.highlights?.length ? <ul className="op-ticks">{t.highlights.map((h) => <li key={h} className="ds-body-sm">{h}</li>)}</ul> : null}

          {/* Once a trip books through Rezdy, its live prices are on the booking page; the website's list could disagree. */}
          {t.prices?.length && !found.bookable ? (
            <>
              <h2 className="ds-micro bk-about__label">Prices</h2>
              <table className="op-prices">
                <tbody>
                  {t.prices.map((p) => (
                    <tr key={`${p.label}-${p.amount}`}>
                      <td className="ds-body-sm">{p.label}{p.note ? <span className="ds-caption bk-muted"> · {p.note}</span> : null}</td>
                      <td className="ds-body-sm op-prices__amount">{money(p.amount, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {t.includes?.length ? (
            <>
              <h2 className="ds-micro bk-about__label">Included</h2>
              <ul className="op-ticks">{t.includes.map((x) => <li key={x} className="ds-body-sm">{x}</li>)}</ul>
            </>
          ) : null}
          {t.bring?.length ? (
            <>
              <h2 className="ds-micro bk-about__label">Bring</h2>
              <ul className="op-list">{t.bring.map((x) => <li key={x} className="ds-body-sm">{x}</li>)}</ul>
            </>
          ) : null}
          {t.requirements ? (
            <>
              <h2 className="ds-micro bk-about__label">Good to know</h2>
              <p className="ds-body bk-about__note">{t.requirements}</p>
            </>
          ) : null}
          {t.offer ? (
            <div className="op-offer op-offer--trip">
              <span className="ds-micro">Offer</span>
              <span className="ds-body-sm">{t.offer.text}</span>
              {t.offer.conditions || t.offer.validUntil ? <span className="ds-caption bk-muted">{[t.offer.conditions, t.offer.validUntil ? `Until ${t.offer.validUntil}` : null].filter(Boolean).join(" · ")}</span> : null}
            </div>
          ) : null}
          {t.images && t.images.length > 1 ? (
            <div className="op-gallery">
              {t.images.slice(1, 4).map((u) => <span key={u} className="op-gallery__img" style={{ backgroundImage: cssImage(u) }} aria-hidden />)}
            </div>
          ) : null}
        </article>

        <aside className="bk-aside">
          <div className="bk-panel">
            {found.bookable ? (
              liveFrom(found.bookable) ? <p className="bk-panel__price"><span className="ds-headline">{liveFrom(found.bookable)}</span> <span className="ds-caption bk-muted">per guest</span></p> : null
            ) : fromText(t) ? (
              <p className="bk-panel__price"><span className="ds-headline">{fromText(t)}</span> {perWhom(t) ? <span className="ds-caption bk-muted">{perWhom(t)}</span> : null}</p>
            ) : null}
            {found.bookable ? (
              <>
                <Link href={`/book/${found.bookable.slug}`} className="bk-cta">Book</Link>
                <p className="ds-micro bk-reef">Booked at {page.name}&rsquo;s own price. A fixed 5% of your fare protects the reef you visit.</p>
              </>
            ) : (
              <>
                <a href={book} className="bk-cta" target="_blank" rel="nofollow noopener noreferrer">Book with {page.name}</a>
                <p className="ds-caption bk-muted">Booked directly with {page.name}, on their own booking page.</p>
              </>
            )}
            <Link href={`/operators/${slug}${preview ? "?preview=1" : ""}`} className="ds-caption">More from {page.name} ›</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
