import Link from "next/link";
import type { ReactNode } from "react";
import OpIcon from "@/components/operators/OpIcon";
import PhotoGallery from "@/components/operators/PhotoGallery";
import { HeroPhoto, LogoTile } from "@/components/operators/LinkedPhoto";
import TripGrid, { type TripCardData } from "@/components/operators/TripGrid";
import VideoGrid from "@/components/operators/VideoGrid";
import { bookingRoute } from "@/lib/services/operators/booking-route";
import { playableVideos } from "@/lib/services/operators/videos";
import type { LoadedPage, PreparedTrip } from "@/lib/services/operators/prepared-pages";

/**
 * The public face of a prepared operator page: who they are and every trip they run, in
 * Bluepass's words with the operator's own facts. It says plainly that the operator has
 * not confirmed it, and books nothing itself until the operator connects: the booking
 * button is theirs.
 *
 * Every page has to read well with no photos at all, because that is what a traveller
 * sees until the operator has claimed it and approved their photos. Without a photo the
 * hero is a dark title block with faint depth contours, and trip cards lead with their
 * summary instead of an empty frame.
 */

type Trip = LoadedPage["trips"][number];

/** Where the page and its trips link to: the public addresses, the admin preview, or the claim review. */
export type PageLinks = { page: string; trip: (tripSlug: string) => string };

function defaultLinks(slug: string, preview: boolean, travellerView: boolean): PageLinks {
  const query = preview ? (travellerView ? "?preview=1&view=traveller" : "?preview=1") : "";
  return { page: `/operators/${slug}${query}`, trip: (tripSlug) => `/operators/${slug}/${tripSlug}${query}` };
}

const KIND: Record<string, [string, string]> = {
  swim: ["Swim", "Swims"],
  snorkel: ["Snorkel", "Snorkelling"],
  dive: ["Dive", "Diving"],
  cruise: ["Cruise", "Cruises"],
  sail: ["Sailing", "Sailing"],
  kayak: ["Kayak", "Kayaking"],
  charter: ["Charter", "Charters"],
  liveaboard: ["Liveaboard", "Liveaboards"],
  course: ["Course", "Courses"],
  tour: ["Tour", "Tours"],
  other: ["Tour", "Tours"],
};
/** "other" reads as a tour, so the two are one kind, not two pills both saying "Tours". */
const kindOf = (k: string) => (KIND[k] && k !== "other" ? k : "tour");
const kindLabel = (k: string) => KIND[kindOf(k)][0];
const kindPlural = (k: string) => KIND[kindOf(k)][1];

function money(amount: number, currency: string) {
  const symbol = currency === "AUD" ? "A$" : currency === "USD" ? "US$" : currency === "BBD" ? "BDS$" : `${currency} `;
  return `${symbol}${amount.toLocaleString("en-AU", { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** The trip's From price: Rezdy's live one when it books on Bluepass, otherwise the website's. */
function priceOf(t: Trip): { amount: number; currency: string; per: string | null } | null {
  if (t.bookable?.priceFrom) return { amount: t.bookable.priceFrom, currency: t.bookable.currency, per: "per guest" };
  const trip = t.trip;
  if (!trip.priceFrom) return null;
  const currency = trip.prices?.find((p) => p.label === trip.priceFromLabel)?.currency ?? trip.prices?.[0]?.currency ?? "AUD";
  return { amount: trip.priceFrom, currency, per: perWhom(trip) };
}

/** "per adult" only when the From price is an adult's fare; a charter's price is for the boat. */
function perWhom(t: PreparedTrip) {
  const label = t.priceFromLabel ?? "";
  if (/\badults?\b/i.test(label)) return "per adult";
  if (/per (person|guest|head)|\bpp\b/i.test(label)) return "per person";
  return null;
}

function websiteHref(url: string) {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

/** "Book with Reef Co"; a long name would not fit a button on a phone, so it says where instead. */
function bookLabel(name: string) {
  return name.length <= 20 ? `Book with ${name}` : "Book on their website";
}

function enquireLabel(name: string) {
  return name.length <= 17 ? `Enquire with ${name}` : "Enquire on their website";
}

function siteName(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function firstSentences(text: string, max = 150) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}...`;
}

export function PreviewBanner({ data, status, travellerView, here }: { data: LoadedPage; status: string; travellerView: boolean; here: string }) {
  const approved = data.photos.approved.length;
  return (
    <div className="opp-preview" role="note">
      <span>
        <strong>Preview for checking.</strong>{" "}
        {status === "approved" ? "This is approved; travellers see only its approved trips." : "Travellers can’t see this until it’s approved."}{" "}
        {travellerView
          ? data.photos.approvedAt
            ? `Showing the ${approved} ${approved === 1 ? "photo" : "photos"} the operator approved${data.own ? ", and any they added," : ""} as travellers see them.`
            : "Showing it as travellers see it: only the photos the operator approved or added."
          : "Every photo shows here for checking."}
      </span>
      <span className="opp-preview__links">
        <Link href={travellerView ? `${here}?preview=1` : `${here}?preview=1&view=traveller`}>
          {travellerView ? "Show every photo" : "See it as travellers do"}
        </Link>
        <Link href={`/admin/operator-pages/${data.slug}`}>Back to checking ›</Link>
      </span>
    </div>
  );
}

function Unconfirmed({ data }: { data: LoadedPage }) {
  if (data.lead.claimed) return null;
  return (
    <p className="opp-note">
      <OpIcon name="info" size={16} />
      <span>
        Prepared by Bluepass from {siteName(data.page.website)}. {data.page.name} hasn’t confirmed it yet, so check prices and times when you book.{" "}
        <Link href={`/operator/claim/start/${data.slug}`} className="opp-note__claim">Is this your business? Claim it ›</Link>
      </span>
    </p>
  );
}

function cardsFor(trips: Trip[], preview: boolean, links: PageLinks, shownAbove: (string | null)[] = []): TripCardData[] {
  // Trips often share their lead photo; each card takes the first of its photos not already on screen.
  const used = new Set(shownAbove.filter((u): u is string => Boolean(u)));
  return trips.map((t) => {
    const price = priceOf(t);
    const images = t.trip.images ?? [];
    const image = images.find((url) => !used.has(url)) ?? images[0] ?? null;
    if (image) used.add(image);
    return {
      href: links.trip(t.slug),
      title: t.trip.title,
      kind: kindOf(t.trip.kind),
      kindLabel: kindLabel(t.trip.kind),
      kindPlural: kindPlural(t.trip.kind),
      meta: [t.trip.duration, t.trip.season].filter(Boolean).join(" · ") || null,
      price: price ? money(price.amount, price.currency) : null,
      per: price?.per ?? null,
      image,
      excerpt: firstSentences(t.trip.summary, 140),
      chip: t.bookable ? "Book now" : t.trip.offer ? "Offer" : t.trip.bookingLinks?.length ? null : "On enquiry",
      check: preview && t.check.status !== "approved" ? (t.check.status === "needs_fix" ? "Needs a fix" : "Not yet approved") : null,
    };
  });
}

/** The cheapest From price across the trips, in the currency most of them use. */
function lowestPrice(trips: Trip[]) {
  // A private charter's whole-boat price is not where a traveller starts; it counts only for an
  // operator that runs nothing but charters. With shared trips and none priced, there is no From.
  const isCharter = (t: Trip) => t.trip.kind === "charter" || /\bprivate\b|\bcharters?\b/i.test(t.trip.title);
  const shared = trips.filter((t) => !isCharter(t));
  const prices = (shared.length ? shared : trips).map(priceOf).filter((p): p is NonNullable<ReturnType<typeof priceOf>> => Boolean(p));
  if (!prices.length) return null;
  const counts = new Map<string, number>();
  for (const p of prices) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const low = Math.min(...prices.filter((p) => p.currency === currency).map((p) => p.amount));
  return money(low, currency);
}

export function PreparedOperatorView({ data, preview, travellerView = false, links, banner }: {
  data: LoadedPage;
  preview: boolean;
  travellerView?: boolean;
  links?: PageLinks;
  /** Shown in place of the preview and "not confirmed" notes: the claim review's bar. */
  banner?: ReactNode;
}) {
  const { page, trips, slug } = data;
  const to = links ?? defaultLinks(slug, preview, travellerView);
  const where = [page.town, page.state].filter(Boolean).join(", ");
  const kinds = [...new Map(trips.map((t) => [kindOf(t.trip.kind), 0])).keys()];
  const plural = kinds.map((k) => kindPlural(k).toLowerCase());
  const runs = plural.length > 3 ? `${plural.slice(0, 3).join(", ")} and more` : joinWords(plural);
  const from = lowestPrice(trips);
  const anyBookable = trips.some((t) => t.bookable);
  const website = websiteHref(page.website);
  const phone = page.contact?.phone;
  const email = page.contact?.email;
  const videos = playableVideos(page.videos);
  // The page's own gallery, or failing that a photo from each trip, so every page that has photos shows them.
  const photos = page.gallery?.length ? page.gallery : [...new Set(trips.flatMap((t) => t.trip.images ?? []))].slice(0, 12);

  return (
    <main className="bk theme-light opp">
      <header className={page.heroImage ? "opp-hero" : "opp-hero opp-hero--plain"}>
        <HeroPhoto src={page.heroImage ?? null} seed={slug} />
        <div className="opp-hero__copy">
          {page.category ? <p className="opp-hero__kicker">{page.category}</p> : null}
          <h1 className="ds-display-lg opp-hero__title">{page.name}</h1>
          {where ? <p className="opp-hero__where"><OpIcon name="pin" size={16} /> {where}</p> : null}
        </div>
      </header>

      <div className="opp-wrap">
        <section className="opp-summary" aria-label="At a glance">
          {page.logo ? <LogoTile src={page.logo} name={page.name} light={Boolean(page.logoLight)} /> : null}
          <dl className="opp-summary__facts">
            <div>
              <dt>{trips.length === 1 ? "Trip" : "Trips"}</dt>
              <dd>{trips.length}</dd>
              {runs ? <dd className="opp-summary__sub">{runs.charAt(0).toUpperCase() + runs.slice(1)}</dd> : null}
            </div>
            {from ? (
              <div>
                <dt>From</dt>
                <dd>{from}</dd>
                <dd className="opp-summary__sub">Their own prices</dd>
              </div>
            ) : null}
            {where ? (
              <div>
                <dt>Based in</dt>
                <dd>{page.town ?? where}</dd>
                {page.state ? <dd className="opp-summary__sub">{page.state}</dd> : null}
              </div>
            ) : null}
          </dl>
          {anyBookable ? (
            <a href="#trips" className="bk-cta opp-summary__cta">Choose a trip</a>
          ) : (
            <a href={website} className="bk-cta opp-summary__cta" target="_blank" rel="nofollow noopener noreferrer">
              {bookLabel(page.name)} <OpIcon name="arrow" size={16} />
            </a>
          )}
        </section>

        {banner ?? (
          <>
            {preview ? <PreviewBanner data={data} status={page.qcStatus} travellerView={travellerView} here={`/operators/${slug}`} /> : null}
            <Unconfirmed data={data} />
          </>
        )}

        <section className={page.standouts?.length ? "opp-about" : "opp-about opp-about--single"}>
          <p className="ds-body-lg opp-about__lead">{page.summary}</p>
          {page.standouts?.length ? (
            <div className="opp-card-plain">
              <h2 className="opp-label">At a glance</h2>
              <ul className="opp-checks">
                {page.standouts.map((s) => <li key={s}><OpIcon name="check" size={16} /><span>{s}</span></li>)}
              </ul>
            </div>
          ) : null}
        </section>

        {videos.length ? <VideoGrid videos={videos} name={page.name} heading="Watch" /> : null}

        <section id="trips" className="opp-section" aria-labelledby="opp-trips">
          <header className="opp-section__head">
            <h2 id="opp-trips" className="ds-headline">{trips.length === 1 ? "The trip" : "Trips"}</h2>
            {trips.length > 1 ? <span className="opp-count">{trips.length}</span> : null}
          </header>
          <TripGrid items={cardsFor(trips, preview, to)} />
        </section>

        <PhotoGallery photos={photos} name={page.name} heading="Photos" min={3} />

        {page.offers?.length ? (
          <section className="opp-section" aria-labelledby="opp-offers">
            <header className="opp-section__head"><h2 id="opp-offers" className="ds-headline">Offers</h2></header>
            <ul className="opp-offers">
              {page.offers.map((o) => (
                <li key={o.text} className="opp-offer">
                  <OpIcon name="tag" size={18} />
                  <span className="opp-offer__text">{o.text}</span>
                  {o.conditions || o.validUntil ? <span className="opp-offer__small">{[o.conditions, o.validUntil ? `Until ${o.validUntil}` : null].filter(Boolean).join(" · ")}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="opp-closing" aria-label={`Contact ${page.name}`}>
          <div>
            <h2 className="ds-headline">Book with {page.name}</h2>
            <p className="opp-closing__sub">On their own booking page, at their own prices.</p>
          </div>
          <div className="opp-closing__actions">
            <a href={website} className="bk-cta" target="_blank" rel="nofollow noopener noreferrer">Go to their booking page <OpIcon name="arrow" size={16} /></a>
            <span className="opp-contacts">
              {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="opp-contact"><OpIcon name="phone" size={16} />{phone}</a> : null}
              {email ? <a href={`mailto:${email}`} className="opp-contact"><OpIcon name="mail" size={16} />{email}</a> : null}
              <a href={website} className="opp-contact" target="_blank" rel="nofollow noopener noreferrer"><OpIcon name="globe" size={16} />{siteName(page.website)}</a>
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}

function List({ title, items, icon }: { title: string; items: string[] | undefined; icon: "check" | null }) {
  if (!items?.length) return null;
  return (
    <div className="opp-card-plain">
      <h2 className="opp-label">{title}</h2>
      <ul className={icon ? "opp-checks" : "opp-dots"}>
        {items.map((x) => <li key={x}>{icon ? <OpIcon name="check" size={16} /> : null}<span>{x}</span></li>)}
      </ul>
    </div>
  );
}

export function PreparedTripView({ data, tripSlug, preview, travellerView = false, links, banner }: {
  data: LoadedPage;
  tripSlug: string;
  preview: boolean;
  travellerView?: boolean;
  links?: PageLinks;
  banner?: ReactNode;
}) {
  const { page, slug } = data;
  const to = links ?? defaultLinks(slug, preview, travellerView);
  const found = data.trips.find((t) => t.slug === tripSlug);
  if (!found) return null;
  const t = found.trip;
  const image = t.images?.[0] ?? null;
  const gallery = (t.images ?? []).slice(1);
  const route = bookingRoute(t, page);
  const where = [page.town, page.state].filter(Boolean).join(", ");
  const price = priceOf(found);
  const others = data.trips.filter((x) => x.slug !== tripSlug).slice(0, 3);
  const facts = [
    t.duration ? { icon: "clock" as const, label: "Duration", value: t.duration } : null,
    t.departureTimes?.length ? { icon: "clock" as const, label: "Departs", value: t.departureTimes.join(", ") } : null,
    t.season ? { icon: "calendar" as const, label: "Season", value: t.season } : null,
    t.departsFrom ? { icon: "anchor" as const, label: "Meet at", value: t.departsFrom } : null,
  ].filter((f): f is NonNullable<typeof f> => Boolean(f));

  return (
    <main className="bk theme-light opp">
      <header className={image ? "opp-hero opp-hero--trip" : "opp-hero opp-hero--trip opp-hero--plain"}>
        <HeroPhoto src={image} seed={`${slug}/${tripSlug}`} />
        <div className="opp-hero__copy">
          <Link href={to.page} className="opp-hero__back"><OpIcon name="back" size={16} />{page.name}</Link>
          <h1 className="ds-display-lg opp-hero__title">{t.title}</h1>
          <p className="opp-hero__where">{[kindLabel(t.kind), t.duration, where].filter(Boolean).join(" · ")}</p>
        </div>
      </header>

      <div className="opp-trip">
        <aside className="opp-trip__aside">
          <div className="bk-panel opp-panel">
            {price ? (
              <p className="opp-panel__price">
                <span className="opp-panel__from">From</span>
                <span className="ds-headline">{money(price.amount, price.currency)}</span>
                {price.per ? <span className="opp-panel__per">{price.per}</span> : null}
              </p>
            ) : (
              <p className="opp-panel__price"><span className="ds-body">{route.kind === "enquire" ? "Price on enquiry" : "Price when you book"}</span></p>
            )}
            {found.bookable ? (
              <>
                <Link href={`/book/${found.bookable.slug}`} className="bk-cta">Book</Link>
                <p className="ds-micro bk-reef">Booked at {page.name}&rsquo;s own price. A fixed 5% of your fare protects the reef you visit.</p>
              </>
            ) : (
              route.kind === "online" ? (
                <>
                  <a href={route.url} className="bk-cta" target="_blank" rel="nofollow noopener noreferrer">{bookLabel(page.name)} <OpIcon name="arrow" size={16} /></a>
                  <p className="opp-panel__note">Live times and prices, on {page.name}&rsquo;s own booking page.</p>
                </>
              ) : (
                <>
                  <a href={route.url} className="bk-cta" target="_blank" rel="nofollow noopener noreferrer">{enquireLabel(page.name)} <OpIcon name="arrow" size={16} /></a>
                  <p className="opp-panel__note">{page.name} takes this one by enquiry, so ask for dates{price ? "" : " and a price"}.</p>
                  {route.email ? <a href={`mailto:${route.email}`} className="opp-contact opp-contact--panel"><OpIcon name="mail" size={16} />{route.email}</a> : null}
                  {route.whatsapp ? <a href={route.whatsapp} className="opp-contact opp-contact--panel" target="_blank" rel="nofollow noopener noreferrer"><OpIcon name="chat" size={16} />Message on WhatsApp</a> : null}
                </>
              )
            )}
            {page.contact?.phone ? (
              <a href={`tel:${page.contact.phone.replace(/[^\d+]/g, "")}`} className="opp-contact opp-contact--panel"><OpIcon name="phone" size={16} />{page.contact.phone}</a>
            ) : null}
          </div>
        </aside>

        <article className="opp-trip__main">
          {banner ?? (
            <>
              {preview ? <PreviewBanner data={data} status={found.check.status} travellerView={travellerView} here={`/operators/${slug}/${tripSlug}`} /> : null}
              <Unconfirmed data={data} />
            </>
          )}

          {facts.length ? (
            <dl className="opp-facts">
              {facts.map((f) => (
                <div key={f.label} className="opp-fact">
                  <OpIcon name={f.icon} size={18} />
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <p className="ds-body-lg opp-about__lead">{t.summary}</p>

          {t.highlights?.length ? (
            <ul className="opp-checks opp-checks--grid">
              {t.highlights.map((h) => <li key={h}><OpIcon name="check" size={16} /><span>{h}</span></li>)}
            </ul>
          ) : null}

          {gallery.length ? <PhotoGallery photos={gallery} name={t.title} /> : null}

          {/* Once a trip books through Rezdy, its live prices are on the booking page; the website's list could disagree. */}
          {t.prices?.length && !found.bookable ? (
            <div className="opp-card-plain">
              <h2 className="opp-label">Prices</h2>
              <ul className="opp-prices">
                {t.prices.map((p) => (
                  <li key={`${p.label}-${p.amount}`}>
                    <span>{p.label}{p.note ? <span className="opp-prices__note">{p.note}</span> : null}</span>
                    <span className="opp-prices__amount">{money(p.amount, p.currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {t.includes?.length || t.bring?.length ? (
            <div className={t.includes?.length && t.bring?.length ? "opp-pair" : ""}>
              <List title="Included" items={t.includes} icon="check" />
              <List title="Bring" items={t.bring} icon={null} />
            </div>
          ) : null}

          {t.requirements ? (
            <div className="opp-callout">
              <OpIcon name="info" size={18} />
              <div>
                <h2 className="opp-label">Good to know</h2>
                <p>{t.requirements}</p>
              </div>
            </div>
          ) : null}

          {t.offer ? (
            <div className="opp-offer opp-offer--trip">
              <OpIcon name="tag" size={18} />
              <span className="opp-offer__text">{t.offer.text}</span>
              {t.offer.conditions || t.offer.validUntil ? <span className="opp-offer__small">{[t.offer.conditions, t.offer.validUntil ? `Until ${t.offer.validUntil}` : null].filter(Boolean).join(" · ")}</span> : null}
            </div>
          ) : null}
        </article>
      </div>

      {others.length ? (
        <section className="opp-more" aria-labelledby="opp-more">
          <header className="opp-section__head">
            <h2 id="opp-more" className="ds-headline">More from {page.name}</h2>
            <Link href={to.page} className="opp-more__all">All {data.trips.length} trips ›</Link>
          </header>
          <TripGrid items={cardsFor(others, preview, to, [image, ...gallery])} filterable={false} />
        </section>
      ) : null}
    </main>
  );
}
