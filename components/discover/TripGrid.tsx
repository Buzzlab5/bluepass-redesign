"use client";

import Image from "next/image";
import { useRef } from "react";
import { gsap, useGSAP, reduced } from "@/lib/gsap";
import {
  regions,
  categories,
  categoryIcon,
  ALL_REGIONS,
  tripMoney,
  type Trip,
} from "@/lib/discover";
import Button from "../ui/Button";
import { MaskLines } from "../ui/Text";
import { useDiscover, RESULTS_ID, type CategoryFilter } from "./DiscoverState";

const filters: CategoryFilter[] = ["All", ...categories];


export default function TripGrid() {
  const ref = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const {
    region,
    category,
    allTrips,
    results,
    saved,
    setCategory,
    pickRegion,
    clearFilters,
    setOpenTrip,
    toggleSaved,
  } = useDiscover();

  const filtered = region !== ALL_REGIONS || category !== "All";
  const others = regions.filter((r) => r.name !== region);

  /* ---- filter pill indicator, same language as the top nav ------------ */
  const moveIndicator = (index: number) => {
    const pill = pillRef.current;
    const ind = indicatorRef.current;
    if (!pill || !ind) return;
    const target = pill.querySelectorAll("button")[index] as HTMLElement | undefined;
    if (!target) return;
    gsap.to(ind, {
      x: target.offsetLeft - 5,
      width: target.offsetWidth,
      duration: reduced() ? 0 : 0.55,
      ease: "bp-out",
      overwrite: true,
    });
  };

  useGSAP(
    () => {
      const run = () => moveIndicator(filters.indexOf(category));
      run();
      document.fonts?.ready.then(run);
      window.addEventListener("resize", run);
      return () => window.removeEventListener("resize", run);
    },
    { dependencies: [category] },
  );

  /* Cards clear out before the set changes, so the grid never pops. */
  const changeFilter = (next: CategoryFilter) => {
    if (next === category) return;
    if (reduced()) {
      setCategory(next);
      return;
    }
    const cards = gsap.utils.toArray<HTMLElement>(".trip", ref.current);
    if (!cards.length) {
      setCategory(next);
      return;
    }
    gsap.to(cards, {
      opacity: 0,
      y: 16,
      scale: 0.985,
      duration: 0.3,
      stagger: 0.025,
      ease: "power2.in",
      onComplete: () => setCategory(next),
    });
  };

  /* ---- entrance / re-entrance on every filter change ------------------ */
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const cards = gsap.utils.toArray<HTMLElement>(".trip", el);

      if (reduced()) {
        gsap.set(cards, { opacity: 1, y: 0, scale: 1 });
        return;
      }

      gsap.fromTo(
        cards,
        { opacity: 0, y: 48, scale: 0.985 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 1.05,
          stagger: 0.07,
          ease: "bp-out",
          clearProps: "transform",
        },
      );

      /* The empty state arrives the same way a card would, so a filter that
         finds nothing still feels like a result rather than a dead end. */
      gsap.from(".tempty", { opacity: 0, y: 34, duration: 0.9, ease: "bp-out" });

      cards.forEach((card) => {
        const img = card.querySelector(".trip__img");
        const cta = card.querySelector(".trip__cta");
        card.addEventListener("pointerenter", () => {
          gsap.to(img, { scale: 1.07, duration: 0.9, ease: "power3.out", overwrite: "auto" });
          gsap.to(card, { y: -8, duration: 0.5, ease: "power3.out", overwrite: "auto" });
          gsap.to(cta, { x: 4, duration: 0.5, ease: "power3.out", overwrite: "auto" });
        });
        card.addEventListener("pointerleave", () => {
          gsap.to(img, { scale: 1, duration: 0.9, ease: "power3.out", overwrite: "auto" });
          gsap.to(card, { y: 0, duration: 0.55, ease: "power3.out", overwrite: "auto" });
          gsap.to(cta, { x: 0, duration: 0.5, ease: "power3.out", overwrite: "auto" });
        });
      });
    },
    { scope: ref, dependencies: [region, category] },
  );

  const onSave = (slug: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    toggleSaved(slug);
    if (!reduced()) {
      gsap.fromTo(
        e.currentTarget,
        { scale: 0.75 },
        { scale: 1, duration: 0.6, ease: "back.out(3.5)" },
      );
    }
  };

  const open = (t: Trip) => setOpenTrip(t);

  return (
    <section
      ref={ref}
      id={RESULTS_ID}
      className="section shell"
      style={{ paddingTop: 72, paddingBottom: "clamp(64px,7vw,96px)" }}
    >
      <div className="tgrid__head">
        <div>
          {/* Keyed so the mask replays when the region changes — the heading is
              the confirmation that a region card did something. */}
          <MaskLines key={region} lines={[region]} className="ds-display-md" />
          <span className="ds-body-sm tgrid__count">
            {results.length} vetted {results.length === 1 ? "trip" : "trips"}
            {category !== "All" ? ` · ${category}` : ""}
          </span>
        </div>

        <div ref={pillRef} className="tfilters" role="group" aria-label="Filter trips by category">
          <span ref={indicatorRef} className="tfilters__ind" aria-hidden />
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => changeFilter(f)}
              aria-pressed={category === f}
              className={category === f ? "is-active" : ""}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered ? (
        <div className="tactive" aria-live="polite">
          <span className="ds-micro tactive__label">Filtered by</span>
          {region !== ALL_REGIONS ? (
            <button type="button" className="tpill" onClick={() => clearFilters()}>
              {region}
              <i aria-hidden>×</i>
              <span className="sr-only">Clear region filter</span>
            </button>
          ) : null}
          {category !== "All" ? (
            <button type="button" className="tpill" onClick={() => changeFilter("All")}>
              {category}
              <i aria-hidden>×</i>
              <span className="sr-only">Clear category filter</span>
            </button>
          ) : null}
          <button type="button" className="tactive__clear ds-micro" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      ) : null}

      {results.length === 0 ? (
        <div className="tempty">
          <span className="tempty__ring" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M15 9l-4.2 1.8L9 15l4.2-1.8z" />
            </svg>
          </span>
          <h3 className="ds-display-md tempty__title">Nothing on this heading yet</h3>
          <p className="ds-body tempty__copy">
            No {category !== "All" ? category.toLowerCase() : ""} trips run out of{" "}
            {region === ALL_REGIONS ? "these waters" : region} this season. Widen the search, or ask
            Kai. We hold departures that never make the grid.
          </p>
          <div className="tempty__acts">
            <Button variant="primary" onClick={clearFilters}>
              Show all {allTrips.length} trips
            </Button>
            <Button
              variant="translucent"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("kai:open", {
                    detail: {
                      message: `I'm looking for a ${
                        category !== "All" ? category.toLowerCase() + " " : ""
                      }trip in ${region === ALL_REGIONS ? "Australia" : region}.`,
                    },
                  }),
                )
              }
            >
              Ask Kai →
            </Button>
          </div>
        </div>
      ) : null}

      <div className={`tgrid ${results.length > 0 && results.length <= 2 ? "tgrid--few" : ""}`}>
        {results.map((t) => (
          <article
            key={t.slug}
            className="trip"
            onClick={() => open(t)}
            aria-labelledby={`trip-${t.slug}`}
          >
            <div className="trip__frame">
              <span className="trip__img">
                <Image
                  src={t.img}
                  alt={`${t.name}, ${t.region}`}
                  fill
                  sizes="(max-width: 760px) 100vw, (max-width: 1180px) 50vw, 33vw"
                  style={{ objectFit: "cover" }}
                />
              </span>
              <span className="trip__shade" />

              {/* "Eco certified" chip removed 2026-08-21 (Tony's UX audit, §9) - all 6 curated
                  trips claimed it but none had a real certifying body behind the claim. Link it
                  to a real standard if one is ever adopted; don't bring the badge back without one. */}
              <span className="trip__chips">
                <span className="chip">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d={categoryIcon[t.category]} />
                  </svg>
                  {t.category}
                </span>
              </span>

              <button
                type="button"
                className={`trip__save ${saved[t.slug] ? "is-saved" : ""}`}
                aria-label={saved[t.slug] ? `Remove ${t.name} from saved` : `Save ${t.name}`}
                aria-pressed={!!saved[t.slug]}
                onClick={(e) => onSave(t.slug, e)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7c0 4.9-7 9.3-7 9.3z" />
                </svg>
              </button>

              <div className="trip__title">
                <span className="trip__loc ds-micro">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11z" />
                    <circle cx="12" cy="10" r="1.6" />
                  </svg>
                  {t.region}
                  {t.rating != null ? (
                    <>
                      <span className="trip__dot">·</span>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3.5l2.4 5.2 5.6.7-4.1 3.9 1 5.6-4.9-2.8-4.9 2.8 1-5.6L4 9.4l5.6-.7z" />
                      </svg>
                      {t.rating} <span className="trip__reviews">({t.reviews})</span>
                    </>
                  ) : null}
                </span>
                <h3 id={`trip-${t.slug}`} className="ds-display-md trip__name">
                  {t.name}
                </h3>
              </div>
            </div>

            <div className="trip__body">
              <div className="ds-body-sm trip__meta">
                {t.operator} <span className="trip__dot">·</span> {t.duration}{" "}
                <span className="trip__dot">·</span> {t.detail}
              </div>

              {/* Impact line, "never a markup" and the per-card testimonial all moved out
                  (Tony's 2026-08-12 UX audit, §4.3 "card diet"): the same three claims were
                  repeating on every one of 6 cards, on top of the hero and (once built) the
                  trust banner saying the same thing once, for the whole page. The impact figure
                  still lives on the trip's own detail sheet ("What the 5% does here"); the
                  no-markup claim moved to the trust banner below the hero. */}
              {t.scarcity ? <span className="trip__scarcity ds-micro">{t.scarcity}</span> : null}

              <div className="trip__foot">
                <div className="trip__price">
                  <span className="ds-display-md">{tripMoney(t.price, t.currency)}</span>
                  <span className="ds-micro">/guest</span>
                </div>
                <span className="trip__cta">
                  <Button variant="translucent" magnetic={false} onClick={() => open(t)}>
                    View trip
                  </Button>
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {region !== ALL_REGIONS ? (
        <div className="thop">
          <span className="ds-micro thop__label">Try another region</span>
          {others.map((r) => (
            <button key={r.slug} type="button" onClick={() => pickRegion(r.name)}>
              {r.name}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
