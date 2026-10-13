"use client";

import { useEffect } from "react";

/**
 * Makes every move to another page of this site a full page load, so the browser shows its own
 * loading spinner in the tab. Next.js normally swaps pages without a load, which leaves the tab
 * looking idle while a slow page is on its way, and visitors were left wondering whether a click
 * did anything.
 *
 * It catches internal link clicks before Next.js's own link handling and lets the browser navigate
 * instead. Left alone: links to another site (FareHarbor's Book now, for one), links opening in a
 * new tab, links to a spot on the same page, downloads, clicks with a modifier key, and any link
 * marked data-soft-nav for the rare case that must keep client-side navigation.
 */
export default function FullPageNavigation() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("data-soft-nav") || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.assign(url.href);
    };
    // Capture phase on document runs before React's own listener, so Next.js never starts its
    // client-side navigation for these clicks.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
