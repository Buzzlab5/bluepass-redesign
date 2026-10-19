"use client";

import Link from "next/link";
import { useState } from "react";
import { failedAlready } from "@/components/operators/LinkedPhoto";

export type TripCardData = {
  href: string;
  title: string;
  kind: string;
  kindLabel: string;
  kindPlural: string;
  meta: string | null;
  price: string | null;
  per: string | null;
  image: string | null;
  excerpt: string | null;
  chip: string | null;
  check: string | null;
};

/**
 * An operator's trips as cards. With six or more trips of more than one kind, pills along
 * the top narrow them to one kind; a short list needs no filtering. A card with a photo
 * leads with it; one without leads with a two-line summary instead of an empty frame.
 */
export default function TripGrid({ items, filterable = true }: { items: TripCardData[]; filterable?: boolean }) {
  const kinds = [...new Map(items.map((t) => [t.kind, t.kindPlural])).entries()]
    .map(([kind, label]) => ({ kind, label, count: items.filter((t) => t.kind === kind).length }))
    .sort((a, b) => b.count - a.count);
  const showPills = filterable && items.length >= 6 && kinds.length > 1;
  const [kind, setKind] = useState<string | null>(null);
  // A photo the operator's server would not send becomes a text card, not a grey box.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const shown = kind ? items.filter((t) => t.kind === kind) : items;

  return (
    <div className="opp-tripgrid">
      {showPills ? (
        <div className="opp-pills" role="tablist" aria-label="Filter trips by kind">
          <button type="button" role="tab" aria-selected={kind === null} className={kind === null ? "opp-pill is-on" : "opp-pill"} onClick={() => setKind(null)}>
            All <span className="opp-pill__n">{items.length}</span>
          </button>
          {kinds.map((k) => (
            <button key={k.kind} type="button" role="tab" aria-selected={kind === k.kind} className={kind === k.kind ? "opp-pill is-on" : "opp-pill"} onClick={() => setKind(k.kind)}>
              {k.label} <span className="opp-pill__n">{k.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      <ul className="opp-cards">
        {shown.map((t) => {
          const image = t.image && !failed.has(t.image) ? t.image : null;
          return (
          <li key={t.href}>
            <Link href={t.href} className={image ? "opp-card" : "opp-card opp-card--text"}>
              {image ? (
                <span className="opp-card__media">
                  {/* Loaded as it scrolls into view: a page of trips should not ask a small operator's server for every photo at once. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="opp-card__img"
                    src={image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    ref={(img) => { if (failedAlready(img)) setFailed((prev) => new Set(prev).add(image)); }}
                    onError={() => setFailed((prev) => new Set(prev).add(image))}
                  />
                  <span className="opp-card__kind">{t.kindLabel}</span>
                </span>
              ) : null}
              <span className="opp-card__body">
                {image ? null : <span className="opp-card__kind opp-card__kind--text">{t.kindLabel}</span>}
                <span className="opp-card__title">{t.title}</span>
                {t.meta ? <span className="opp-card__meta">{t.meta}</span> : null}
                {!image && t.excerpt ? <span className="opp-card__excerpt">{t.excerpt}</span> : null}
                <span className="opp-card__foot">
                  {t.price ? (
                    <span className="opp-card__price">
                      <span className="opp-card__from">From</span> {t.price}
                      {t.per ? <span className="opp-card__per"> {t.per}</span> : null}
                    </span>
                  ) : (
                    <span className="opp-card__price opp-card__price--none">Price when you book</span>
                  )}
                  {t.chip ? <span className="opp-chip">{t.chip}</span> : null}
                </span>
                {t.check ? <span className="opp-chip opp-chip--warn">{t.check}</span> : null}
              </span>
            </Link>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
