"use client";

import { useCallback, useEffect, useState } from "react";
import { failedAlready } from "@/components/operators/LinkedPhoto";

/**
 * A grid of the operator's photos that opens full screen: arrows or swipe through them,
 * Escape or the cross to close. The first photo leads at double size; past nine, the last
 * tile says how many more there are. A photo that will not load leaves the grid and the
 * viewer, and with fewer than `min` left the gallery, heading and all, is not shown.
 */
export default function PhotoGallery({ photos: linked, name, heading, min = 1 }: { photos: string[]; name: string; heading?: string; min?: number }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const fail = useCallback((url: string) => setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url))), []);
  const photos = linked.filter((url) => !failed.has(url));
  const [open, setOpen] = useState<number | null>(null);
  const shown = photos.slice(0, 9);
  const more = photos.length - shown.length;
  const step = useCallback((by: number) => setOpen((i) => (i === null ? i : (i + by + photos.length) % photos.length)), [photos.length]);
  // A photo dropping out while the viewer is open must not leave it pointing past the end.
  useEffect(() => {
    if (open !== null && open >= photos.length) setOpen(photos.length ? photos.length - 1 : null);
  }, [open, photos.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, step]);

  const [touchX, setTouchX] = useState<number | null>(null);
  if (photos.length < min) return null;

  const grid = (
    <>
      <ul className={`opp-photogrid opp-photogrid--${Math.min(shown.length, 5)}`}>
        {shown.map((url, i) => (
          <li key={url}>
            <button type="button" className="opp-photogrid__item" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1} of ${photos.length}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                ref={(img) => { if (failedAlready(img)) fail(url); }}
                onError={() => fail(url)}
              />
              {more > 0 && i === shown.length - 1 ? <span className="opp-photogrid__more">+{more}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && photos[open] ? (
        <div
          className="opp-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${name} photos`}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}
          onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX === null) return;
            const dx = e.changedTouches[0].clientX - touchX;
            if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
            setTouchX(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="opp-lightbox__img"
            src={photos[open]}
            alt={`${name}, photo ${open + 1} of ${photos.length}`}
            referrerPolicy="no-referrer"
            onError={() => fail(photos[open])}
          />
          <span className="opp-lightbox__count">{open + 1} / {photos.length}</span>
          <button type="button" className="opp-lightbox__btn opp-lightbox__close" onClick={() => setOpen(null)} aria-label="Close">✕</button>
          {photos.length > 1 ? (
            <>
              <button type="button" className="opp-lightbox__btn opp-lightbox__prev" onClick={() => step(-1)} aria-label="Previous photo">‹</button>
              <button type="button" className="opp-lightbox__btn opp-lightbox__next" onClick={() => step(1)} aria-label="Next photo">›</button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (!heading) return grid;
  return (
    <section className="opp-section" aria-labelledby="opp-photos">
      <header className="opp-section__head">
        <h2 id="opp-photos" className="ds-headline">{heading}</h2>
        <span className="opp-count">{photos.length}</span>
      </header>
      {grid}
    </section>
  );
}
