"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Contours from "@/components/operators/Contours";

/**
 * Prepared pages link photos straight from the operator's own site, and some sites refuse
 * to send them to other pages or are simply down. Every slot that shows one drops it when
 * it fails, so a traveller never sees a broken image. A photo can fail before React starts
 * listening, so each one is also checked as it mounts.
 */
export function failedAlready(img: HTMLImageElement | null): boolean {
  return Boolean(img && img.complete && img.currentSrc && img.naturalWidth === 0);
}

function useBrokenImage(src: string | null | undefined) {
  const ref = useRef<HTMLImageElement>(null);
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => {
    if (src && failedAlready(ref.current)) setBroken(src);
  }, [src]);
  const fail = useCallback(() => setBroken(src ?? null), [src]);
  return { ref, broken: Boolean(src) && broken === src, fail };
}

/** The photo behind a page's title, over faint contours that show if it never arrives. */
export function HeroPhoto({ src, seed }: { src: string | null; seed: string }) {
  const { ref, broken, fail } = useBrokenImage(src);
  return (
    <>
      <Contours seed={seed} />
      {src && !broken ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={ref} className="opp-hero__img" src={src} alt="" referrerPolicy="no-referrer" fetchPriority="high" onError={fail} />
          <div className="opp-hero__shade" />
        </>
      ) : null}
    </>
  );
}

/**
 * The operator's logo in its tile; with no logo that loads, no tile. A long wordmark gets a
 * wider, shorter tile, or it would shrink to a sliver in a square one.
 */
export function LogoTile({ src, name, light }: { src: string; name: string; light: boolean }) {
  const { ref, broken, fail } = useBrokenImage(src);
  const [wide, setWide] = useState(false);
  const measure = (img: HTMLImageElement) => setWide(img.naturalHeight > 0 && img.naturalWidth / img.naturalHeight > 4);
  useEffect(() => {
    if (ref.current?.complete) measure(ref.current);
  }, [ref, src]);
  if (broken) return null;
  return (
    <span className={["opp-summary__logo", light ? "opp-summary__logo--dark" : "", wide ? "opp-summary__logo--wide" : ""].filter(Boolean).join(" ")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} src={src} alt={`${name} logo`} referrerPolicy="no-referrer" onError={fail} onLoad={(e) => measure(e.currentTarget)} />
    </span>
  );
}
