"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "loading" | "done";

/** A navigation quicker than this never shows the bar, so instant page changes stay still. */
const SHOW_AFTER_MS = 150;
/** If the next page never arrives, stop pretending something is happening. */
const GIVE_UP_MS = 20_000;

/**
 * A thin line along the top of the screen while a page change is waiting on the server.
 *
 * Pages change without reloading the document (so the navbar stays put), which means the browser's
 * own tab spinner never starts. This is the stand-in: it appears only when a click has had no answer
 * for a moment, creeps toward the right while it waits, and finishes when the new page arrives.
 *
 * It starts from a click on a link to another page of this site, the same clicks Next.js turns into
 * a page change, and ends when the path changes.
 */
export default function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef(false);
  const shown = useRef(false);

  const clearTimers = () => {
    for (const timer of [showTimer, giveUpTimer, resetTimer]) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const finish = () => {
    const wasShown = shown.current;
    waiting.current = false;
    shown.current = false;
    clearTimers();
    if (!wasShown) {
      setPhase("idle");
      return;
    }
    setPhase("done");
    resetTimer.current = setTimeout(() => setPhase("idle"), 500);
  };

  // The new page has arrived.
  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      clearTimers();
      waiting.current = true;
      showTimer.current = setTimeout(() => {
        if (!waiting.current) return;
        shown.current = true;
        setPhase("loading");
      }, SHOW_AFTER_MS);
      giveUpTimer.current = setTimeout(finish, GIVE_UP_MS);
    };

    /* Capture phase: Next.js's own link handler runs first otherwise, calls preventDefault to take
       over the click, and this would then skip exactly the clicks it exists for. */
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="route-progress" data-phase={phase} aria-hidden />;
}
