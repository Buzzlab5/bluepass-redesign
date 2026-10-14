"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useSession } from "@/components/auth/SessionProvider";
import Button from "@/components/ui/Button";
import { gsap, useGSAP, reduced } from "@/lib/gsap";
import { lockScroll, scrollToEl, unlockScroll } from "@/lib/lenis";
import { ALL_REGIONS, trips as staticTrips, type Category, type Trip } from "@/lib/discover";

export type CategoryFilter = "All" | Category;

type WishlistToast = { message: string };

type Ctx = {
  /** Selected region name, or ALL_REGIONS. */
  region: string;
  category: CategoryFilter;
  /** Every trip in scope, unfiltered - the curated 6 plus any real synced listings. */
  allTrips: Trip[];
  /** Trips left after both filters. */
  results: Trip[];
  /** The trip whose sheet is open, if any. */
  openTrip: Trip | null;
  /** Shortlist, keyed by slug. Shared so the grid and the sheet agree. */
  saved: Record<string, boolean>;

  setRegion: (r: string) => void;
  setCategory: (c: CategoryFilter) => void;
  /** Select a region and travel to the results — what a region card does. */
  pickRegion: (r: string) => void;
  clearFilters: () => void;
  goToResults: () => void;
  setOpenTrip: (t: Trip | null) => void;
  toggleSaved: (slug: string) => void;
};

const DiscoverCtx = createContext<Ctx | null>(null);

/** Results are the anchor for every filter action, so the id lives here. */
export const RESULTS_ID = "results";

export function useDiscover() {
  const ctx = useContext(DiscoverCtx);
  if (!ctx) throw new Error("useDiscover must be used inside <DiscoverState>");
  return ctx;
}

/** Trips per region, so the rail can show a live count against each card. Uses the static/curated set only. */
export const countForRegion = (region: string, category: CategoryFilter) =>
  staticTrips.filter(
    (t) =>
      (region === ALL_REGIONS || t.region === region) &&
      (category === "All" || t.category === category),
  ).length;

export default function DiscoverState({
  children,
  trips = staticTrips,
}: {
  children: ReactNode;
  /**
   * The full trip set to filter/display. Defaults to the static curated 6 so any
   * caller that doesn't pass this prop keeps behaving exactly as before. The real
   * page passes the curated trips plus real synced OperatorListing rows.
   */
  trips?: Trip[];
}) {
  const [region, setRegionState] = useState(ALL_REGIONS);
  const [category, setCategoryState] = useState<CategoryFilter>("All");
  const [openTrip, setOpenTrip] = useState<Trip | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<WishlistToast | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [mounted, setMounted] = useState(false);
  const authPromptRef = useRef<HTMLDivElement>(null);
  const { traveller } = useSession();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!showAuthPrompt) return;
    lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAuthPrompt(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlockScroll();
      window.removeEventListener("keydown", onKey);
    };
  }, [showAuthPrompt]);

  /* Same entrance language as .tsheet: backdrop fades, panel pops up out of a slight scale/y
     offset rather than just appearing - a plain conditional render reads as a flash/blink. */
  useGSAP(
    () => {
      const el = authPromptRef.current;
      if (!el || !showAuthPrompt) return;

      const panel = el.querySelector(".wauth__panel");
      if (reduced()) {
        gsap.set([el.querySelector(".wauth__backdrop"), panel], { opacity: 1, y: 0, scale: 1 });
        return;
      }

      gsap
        .timeline()
        .fromTo(el.querySelector(".wauth__backdrop"), { opacity: 0 }, { opacity: 1, duration: 0.35 }, 0)
        .fromTo(
          panel,
          { y: 22, opacity: 0, scale: 0.96 },
          { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "bp-out" },
          0.03,
        );
    },
    { dependencies: [showAuthPrompt] },
  );
  /* Nothing is written to the URL until the visitor actually filters, so a
     clean /discover link stays clean. */
  const [touched, setTouched] = useState(false);

  /* Hydrate from the signed-in traveller's real shortlist. A guest gets `{ slugs: [] }` back rather
     than an error, so this is harmless either way - the heart already works locally before this
     resolves, this just makes a signed-in traveller's saves survive a reload. */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/saved-trips")
      .then((res) => (res.ok ? res.json() : { slugs: [] }))
      .then((data: { slugs?: string[] }) => {
        if (cancelled || !data.slugs?.length) return;
        setSaved((s) => {
          const next = { ...s };
          for (const slug of data.slugs!) next[slug] = true;
          return next;
        });
      })
      .catch(() => {
        // Offline or Kai-adjacent hiccup - the shortlist just stays local-only for this visit.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- read the opening state out of the URL --------------------------- */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get("region");
    const c = q.get("category");
    if (r && trips.some((t) => t.region === r)) setRegionState(r);
    if (c && trips.some((t) => t.category === c)) setCategoryState(c as Category);
    /* A link to one trip (Kai sends these): open its sheet. A slug that matches nothing is ignored,
       so an old link just lands on the home page. */
    const wanted = q.get("trip");
    const linked = wanted ? trips.find((t) => t.slug === wanted) : undefined;
    if (linked) setOpenTrip(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- and keep it there, so a filtered view is shareable -------------- */
  useEffect(() => {
    if (!touched) return;
    const q = new URLSearchParams(window.location.search);
    if (region === ALL_REGIONS) q.delete("region");
    else q.set("region", region);
    if (category === "All") q.delete("category");
    else q.set("category", category);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [region, category, touched]);

  const results = useMemo(
    () =>
      trips.filter(
        (t) =>
          (region === ALL_REGIONS || t.region === region) &&
          (category === "All" || t.category === category),
      ),
    [trips, region, category],
  );

  const goToResults = useCallback(() => {
    scrollToEl(document.getElementById(RESULTS_ID), -110);
  }, []);

  const setRegion = useCallback((r: string) => {
    setTouched(true);
    setRegionState(r);
  }, []);

  const setCategory = useCallback((c: CategoryFilter) => {
    setTouched(true);
    setCategoryState(c);
  }, []);

  /* Tapping the region you are already on clears it — the card is a toggle,
     which saves hunting for a reset control. */
  const pickRegion = useCallback(
    (r: string) => {
      setTouched(true);
      setRegionState((cur) => (cur === r ? ALL_REGIONS : r));
      goToResults();
    },
    [goToResults],
  );

  const clearFilters = useCallback(() => {
    setTouched(true);
    setRegionState(ALL_REGIONS);
    setCategoryState("All");
  }, []);

  /* A guest's tap doesn't get a silent, locally-flipped heart that quietly forgets itself on
     reload - it gets stopped with an actual modal, not a toast easy to miss at the bottom of the
     screen while looking at a card near the top. Only a signed-in traveller's tap toggles anything,
     so the toast can promise "saved" and mean it. */
  const toggleSaved = useCallback(
    (slug: string) => {
      if (!traveller) {
        setShowAuthPrompt(true);
        return;
      }

      const willBeSaved = !saved[slug];
      setSaved((s) => ({ ...s, [slug]: willBeSaved }));
      setToast({ message: willBeSaved ? "Saved to your wishlist." : "Removed from your wishlist." });
      fetch("/api/account/saved-trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripSlug: slug }),
      }).catch(() => {
        // Local state already reflects the click; persistence is best-effort.
      });
    },
    [traveller, saved],
  );

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const value = useMemo<Ctx>(
    () => ({
      region,
      category,
      allTrips: trips,
      results,
      openTrip,
      saved,
      setRegion,
      setCategory,
      pickRegion,
      clearFilters,
      goToResults,
      setOpenTrip,
      toggleSaved,
    }),
    [
      region,
      category,
      trips,
      results,
      openTrip,
      saved,
      setRegion,
      setCategory,
      pickRegion,
      clearFilters,
      goToResults,
      toggleSaved,
    ],
  );

  const next = mounted ? window.location.pathname + window.location.search : "/";

  return (
    <DiscoverCtx.Provider value={value}>
      {children}
      {toast ? (
        <div className="wtoast" role="status">
          <span className="ds-body-sm wtoast__text">{toast.message}</span>
          <button type="button" className="wtoast__close" aria-label="Dismiss" onClick={() => setToast(null)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}
      {mounted && showAuthPrompt
        ? createPortal(
            <div ref={authPromptRef} className="wauth" role="dialog" aria-modal="true" aria-labelledby="wauth-title">
              <button
                type="button"
                className="wauth__backdrop"
                aria-label="Close"
                onClick={() => setShowAuthPrompt(false)}
              />
              <div className="wauth__panel">
                <button
                  type="button"
                  className="wauth__close"
                  aria-label="Close"
                  onClick={() => setShowAuthPrompt(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
                <span className="wauth__icon" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.8 4.6c-2-1.6-4.9-1.3-6.6.5L12 7.4l-2.2-2.3c-1.7-1.8-4.6-2.1-6.6-.5-2.3 1.9-2.5 5.4-.4 7.5l8.7 8.9c.3.3.7.3 1 0l8.7-8.9c2.1-2.1 1.9-5.6-.4-7.5z" />
                  </svg>
                </span>
                <h2 id="wauth-title" className="ds-headline wauth__title">
                  Sign in to save this trip.
                </h2>
                <p className="ds-body-sm wauth__body">
                  One account keeps every trip you've saved in one place, wherever you come back
                  from.
                </p>
                <div className="wauth__actions">
                  <Link href={`/login?next=${encodeURIComponent(next)}`} style={{ textDecoration: "none" }}>
                    <Button variant="primary" magnetic={false}>
                      Sign in
                    </Button>
                  </Link>
                  <Link href={`/register?next=${encodeURIComponent(next)}`} style={{ textDecoration: "none" }}>
                    <Button variant="secondary" magnetic={false}>
                      Create account
                    </Button>
                  </Link>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </DiscoverCtx.Provider>
  );
}
