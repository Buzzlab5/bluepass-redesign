"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { gsap, ScrollTrigger, useGSAP, reduced } from "@/lib/gsap";
import { navLinks } from "@/lib/data";
import Button from "./ui/Button";
import AccountMenu from "./auth/AccountMenu";
import { useSession } from "./auth/SessionProvider";
import { isChromelessPathname } from "@/lib/services/pathname";

export default function Nav() {
  const ref = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { traveller, signOut } = useSession();

  /* The auth pages carry their own brand mark inside the poster panel and have
     no use for a marketing nav — leaving it up stacked two Bluepass marks in
     the same corner and offered "Join Bluepass" to someone already on
     /register. The consoles are the same story: each has its own rail, its own
     mark, and no business offering "Join Bluepass" to someone already signed in
     and working. `isConsolePathname` covers every console area rather than the
     one this check was originally written for. */
  const bare =
    ["/login", "/register", "/reset-password", "/partners/apply"].includes(pathname) ||
    isChromelessPathname(pathname);
  /* The index the white indicator is actually sitting under.
     This used to be a separate `hover` state, and the split was the bug: the text colour read
     `hover ?? active` while the indicator's position was set independently by `moveIndicator`. The
     two could disagree — and when they did, a link rendered in `--color-on-primary` (#0a0a09, near
     black) with no white pill behind it, which is a black block where a word should be.
     It desynced reliably once the Kai panel existed: `.kpanel__veil` covers the whole viewport,
     navbar included, so a pointer moving from a nav link into the panel never fires the pill's
     `onPointerLeave`. `hover` stayed put while the `[active, bare]` effect slid the indicator home.
     Deriving both from one value makes the disagreement unrepresentable. */
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  /* Section links (/#conservation) only count as current while on that page. "/" already resolves
     to index 0 on its own (navLinks[0].href is "/") - no fallback needed for it. A real, separate
     page that just isn't one of the four nav items - /account chief among them - gets no pill at
     all rather than a wrong one; moveIndicator already clears the indicator cleanly on -1 (used
     2026-08-21, after "Trips" stayed lit while signed-in travellers were looking at their own
     saved trips, which read as the nav not knowing where they actually were). */
  const active = navLinks.findIndex((l) => l.href === pathname);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const brand = el.querySelector(".nav__brand");
      const pill = pillRef.current;
      const actions = el.querySelector(".nav__actions");

      /* ---- entrance -------------------------------------------------- */
      if (!reduced()) {
        gsap
          .timeline({ delay: 0.15 })
          .from(el, { yPercent: -100, duration: 1.1, ease: "bp-out" })
          .from(brand, { opacity: 0, x: -14, duration: 0.8 }, "-=0.6")
          .from(
            pill ? Array.from(pill.querySelectorAll("a")) : [],
            { opacity: 0, y: 10, duration: 0.6, stagger: 0.05 },
            "-=0.55",
          )
          .from(actions, { opacity: 0, x: 14, duration: 0.7 }, "-=0.6");
      }

      /* ---- transparent over the hero, condensed once past it ---------
         The surface is its own element: the hide/reveal tween below owns the
         nav's transform, and letting both tweens target the same element is
         what previously left the bar stuck opaque after scrolling back up. */
      const surface = el.querySelector(".nav__surface");
      const condense = gsap
        .timeline({ paused: true })
        .to(
          surface,
          {
            backgroundColor: "rgba(10,10,9,0.72)",
            backdropFilter: "blur(18px)",
            borderBottomColor: "rgba(255,255,255,0.12)",
            duration: 0.5,
            ease: "power2.out",
          },
          0,
        )
        .to(el, { height: 64, duration: 0.5, ease: "power2.out" }, 0)
        .to(pill, { backgroundColor: "rgba(26,26,24,0.92)", duration: 0.5 }, 0);

      ScrollTrigger.create({
        start: 40,
        end: "max",
        onEnter: () => condense.play(),
        onLeaveBack: () => condense.reverse(),
      });

      /* ---- hide going down, reveal going up -------------------------- */
      if (!reduced()) {
        let last = 0;
        ScrollTrigger.create({
          start: 240,
          end: "max",
          onUpdate: (self) => {
            const y = self.scroll();
            if (Math.abs(y - last) < 12) return;
            const down = y > last;
            last = y;
            if (open) return;
            gsap.to(el, {
              yPercent: down ? -110 : 0,
              duration: 0.55,
              ease: "power3.out",
              overwrite: "auto",
            });
          },
          onLeaveBack: () => gsap.to(el, { yPercent: 0, duration: 0.4, overwrite: "auto" }),
        });
      }
    },
    /* `bare` matters here: this component never unmounts (it lives in the root
       layout), it just renders null on the auth routes. Without it in the deps
       the effect runs once at mount, and coming back from /login re-creates the
       markup with no ScrollTriggers attached — the bar then sits there always
       visible, never condensing and never hiding on scroll. */
    { scope: ref, dependencies: [bare] },
  );

  /* ---- sliding pill indicator ---------------------------------------- */
  const moveIndicator = (index: number) => {
    const pill = pillRef.current;
    const ind = indicatorRef.current;
    if (!pill || !ind) return;
    const target = pill.querySelectorAll("a")[index] as HTMLElement | undefined;
    /* Nothing to sit under — `active` is -1 on any page not in the nav. Clearing here is what stops
       a stale link keeping the dark-on-dark colour after the indicator gives up. */
    if (!target) {
      setHighlighted(null);
      return;
    }
    setHighlighted(index);
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
      const run = () => moveIndicator(active);
      run();
      document.fonts?.ready.then(run);
      window.addEventListener("resize", run);
      return () => window.removeEventListener("resize", run);
    },
    /* Same reason, plus its own: `active` is 0 on the auth routes *and* on home,
       so returning from /login never changed it and the pill indicator was
       never re-measured — which is why home lost its white bubble. */
    { dependencies: [active, bare] },
  );

  /* ---- mobile overlay menu ------------------------------------------- */
  useGSAP(
    () => {
      const panel = menuRef.current;
      if (!panel) return;
      const items = panel.querySelectorAll(".nav__menu-item");

      if (open) {
        gsap.set(panel, { display: "flex" });
        gsap
          .timeline()
          .fromTo(
            panel,
            { clipPath: "inset(0 0 100% 0)" },
            { clipPath: "inset(0 0 0% 0)", duration: 0.7, ease: "bp-inOut" },
          )
          .fromTo(
            items,
            { yPercent: 120, opacity: 0 },
            { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.06 },
            "-=0.35",
          );
      } else {
        gsap.to(panel, {
          clipPath: "inset(0 0 100% 0)",
          duration: 0.5,
          ease: "bp-inOut",
          onComplete: () => gsap.set(panel, { display: "none" }),
        });
      }
    },
    { dependencies: [open] },
  );

  const linkColor = (i: number) =>
    highlighted === i ? "var(--color-on-primary)" : "var(--color-ink-muted)";

  if (bare) return null;

  return (
    <>
      <nav
        ref={ref}
        className="nav"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          background: "transparent",
          height: 76,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--page-gutter)",
          willChange: "transform",
        }}
      >
        <span
          className="nav__surface"
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(10,10,9,0)",
            borderBottom: "1px solid rgba(255,255,255,0)",
            pointerEvents: "none",
          }}
        />

        <Link
          href="/"
          className="nav__brand"
          style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, textDecoration: "none" }}
        >
          {/* Transparent inside, ringed outside — same 38px circle as
              .acct__circle at the other end of the bar, so the two read as a
              matched pair rather than a mark and a button. */}
          <span
            style={{
              position: "relative",
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.55)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <Image
              src="/bluepass-logo-transparent.png"
              alt=""
              width={24}
              height={24}
              priority
              style={{ width: 24, height: 24, objectFit: "contain" }}
            />
          </span>
          <span className="ds-headline" style={{ fontSize: 19, letterSpacing: -0.4, whiteSpace: "nowrap" }}>
            Bluepass
          </span>
        </Link>

        <div
          ref={pillRef}
          className="nav__pill"
          onPointerLeave={() => {
            moveIndicator(active);
          }}
          style={{
            position: "relative",
            alignItems: "center",
            gap: 2,
            /* No `backdrop-filter` here, unlike the avatar and the burger — and that omission is
               the fix, not an oversight.
               `backdrop-filter` re-samples whatever is painted behind the element every time the
               compositor invalidates that region. The Kai panel sits above the navbar (its veil is
               a full-viewport layer at z-index 150), so hovering a card button repaints through
               that stack and forces this pill to re-sample. Chrome resolves the sample wrongly at a
               large `border-radius`, and the worst-hit spot is the corner with nothing drawn over
               it — the bare right cap past the last link, which flashed black on every hover. The
               left cap never showed it because the white active indicator paints over it.
               Dropping the blur removes the sampling entirely, so there is nothing left to
               mis-sample. The fill alone still reads as a container against the hairline below.
               Note the avatar and burger keep their blur: they are small, fully covered by their
               own content, and were never reported — but they sit on the same mechanism, so if a
               dark flash ever shows up on them, this is the reason and this is the fix. */
            background: "rgba(26,26,24,0.30)",
            /* The same hairline the avatar and the burger already carry, and for the same reason:
               this pill is glass over a photograph, so without a defined edge it has none. It was
               the only glass element in the navbar missing it, which showed up worst as the strip
               of bare pill after the last link — the white indicator caps the left end, so that
               tail was the only dark run with nothing to bound it and read as a smudge rather than
               as the container it is. */
            border: "1px solid var(--color-hairline-soft)",
            padding: 5,
            borderRadius: "var(--radius-pill)",
            minWidth: 0,
          }}
        >
          <span
            ref={indicatorRef}
            aria-hidden
            style={{
              position: "absolute",
              left: 5,
              top: 5,
              bottom: 5,
              width: 0,
              borderRadius: "var(--radius-pill)",
              background: "var(--color-ink)",
              pointerEvents: "none",
            }}
          />
          {navLinks.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              onPointerEnter={() => {
                moveIndicator(i);
              }}
              style={{
                position: "relative",
                padding: "8px 14px",
                borderRadius: "var(--radius-pill)",
                color: linkColor(i),
                fontFamily: "var(--font-body)",
                fontSize: "var(--type-body-sm-size)",
                fontWeight: highlighted === i ? 600 : 500,
                whiteSpace: "nowrap",
                flex: "none",
                textDecoration: "none",
                transition: "color .3s ease",
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div
          className="nav__actions"
          style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {/* Signed in, "Join Bluepass" has nothing left to offer, and its slot becomes the
              wishlist shortcut instead — deep-links straight into the "Saved trips" tab on
              /account (AccountTabs.tsx) rather than the "Your trips" bookings tab that the
              account-menu link below opens by default. Two real tabs now, not two anchors into
              one long scroll (2026-08-21, after the user pointed out both links landed on what
              looked like the same page). */}
          {traveller ? (
            <Link
              href="/account?tab=saved"
              className="nav__avatar acct__circle acct__circle--link"
              aria-label="Your saved trips"
              title="Saved trips"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7c0 4.9-7 9.3-7 9.3z" />
              </svg>
            </Link>
          ) : (
            <Button variant="primary" onClick={() => window.location.assign("/register")}>
              Join Bluepass →
            </Button>
          )}
          <AccountMenu />
          <button
            type="button"
            className="nav__burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <i style={{ transform: open ? "translateY(3px) rotate(45deg)" : "none" }} />
            <i style={{ transform: open ? "translateY(-3px) rotate(-45deg)" : "none" }} />
          </button>
        </div>
      </nav>

      <div ref={menuRef} className="nav__menu" style={{ display: "none" }}>
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="nav__menu-item"
            onClick={() => setOpen(false)}
          >
            {link.label}
          </Link>
        ))}

        {/* Below 560px the avatar is hidden, so the burger menu is the only way
            to reach the account at all. */}
        <div className="nav__menu-acct">
          {traveller ? (
            <>
              <span className="ds-micro nav__menu-who">
                Signed in as {traveller.name ?? traveller.email}
              </span>
              <Link
                href="/account?tab=saved"
                className="nav__menu-link ds-body"
                onClick={() => setOpen(false)}
              >
                Saved trips
              </Link>
              <button
                type="button"
                className="nav__menu-link ds-body"
                onClick={async () => {
                  await signOut();
                  setOpen(false);
                  window.location.assign("/");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="nav__menu-link ds-body" onClick={() => setOpen(false)}>
                Sign in
              </Link>
              <Link
                href="/register"
                className="nav__menu-link nav__menu-link--go ds-body"
                onClick={() => setOpen(false)}
              >
                Join Bluepass →
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
