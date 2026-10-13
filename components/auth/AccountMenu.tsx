"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP, reduced } from "@/lib/gsap";
import { initialsOf } from "@/lib/auth-client";
import { useSession } from "./SessionProvider";

/**
 * The nav avatar, made real.
 *
 * The 38px glass circle keeps the exact geometry it had as a decorative
 * `<span>` — this adds behaviour to that shape, it does not restyle it. Signed
 * out it walks to /login; signed in it opens a panel that drops out of the
 * circle itself, so the menu reads as the avatar unfolding rather than a
 * detached dropdown.
 */
export default function AccountMenu() {
  const { traveller, loading, signOut } = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  /* Close on outside click and on Escape — a nav-level panel that traps neither
     focus nor clicks would sit over the page's own controls. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useGSAP(
    () => {
      const panel = ref.current?.querySelector(".acct__panel");
      if (!panel || !open || reduced()) return;
      gsap
        .timeline()
        .fromTo(
          panel,
          { opacity: 0, y: -12, scaleY: 0.9, transformOrigin: "top right" },
          { opacity: 1, y: 0, scaleY: 1, duration: 0.45, ease: "bp-out" },
        )
        .fromTo(
          panel.querySelectorAll(".acct__row"),
          { opacity: 0, y: -8 },
          { opacity: 1, y: 0, duration: 0.4, stagger: 0.05 },
          0.1,
        );
    },
    { scope: ref, dependencies: [open] },
  );

  const onSignOut = async () => {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    setOpen(false);
    window.location.assign("/");
  };

  /* Until /api/auth/me settles, render the resting circle. Guessing "signed
     out" here would flash a sign-in prompt at people who are signed in. */
  if (loading) {
    return (
      <span className="nav__avatar acct__circle" aria-hidden>
        <span className="acct__pending" />
      </span>
    );
  }

  if (!traveller) {
    return (
      <Link
        href="/login"
        className="nav__avatar acct__circle acct__circle--link"
        aria-label="Sign in to Bluepass"
        title="Sign in"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink)" strokeWidth="1.8">
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20c1.5-4 4.5-6 7-6s5.5 2 7 6" strokeLinecap="round" />
        </svg>
      </Link>
    );
  }

  /* Admin outranks the others for this badge: it's the highest-privilege role an account can
     carry, and a staff member who also happens to hold an operator or partner profile is still
     signed in as staff first. */
  const roleLabel = traveller.roles.includes("ADMIN")
    ? "Admin"
    : traveller.operatorProfile
      ? (traveller.operatorProfile.companyName ?? "Operator")
      : traveller.partnerProfile
        ? `@${traveller.partnerProfile.handle ?? "partner"}`
        : "Traveller";

  return (
    <div ref={ref} className="acct">
      <button
        type="button"
        className="nav__avatar acct__circle acct__circle--on"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${traveller.name ?? traveller.email}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="acct__initials">{initialsOf(traveller)}</span>
      </button>

      {open ? (
        <div className="acct__panel" role="menu">
          <div className="acct__head">
            <span className="acct__head-initials" aria-hidden>
              {initialsOf(traveller)}
            </span>
            <span className="acct__head-text">
              <span className="ds-body-sm acct__name">{traveller.name ?? "Traveller"}</span>
              <span className="ds-micro acct__email">{traveller.email}</span>
            </span>
          </div>

          <span className="acct__badge ds-micro">{roleLabel}</span>

          <div className="acct__rows">
            {/* Admin has no profile row to gate on — unlike operator/partner, `requireCurrentAdmin`
                only ever checks the role (or the `BLUEPASS_ADMIN_EMAILS` allowlist, which this
                client-side menu can't see; an allowlisted-but-roleless admin can still reach
                /admin directly by URL, just without this shortcut). Shown first: it's the
                highest-privilege surface an account can reach, so it leads. */}
            {traveller.roles.includes("ADMIN") ? (
              <Link
                href="/admin"
                className="acct__row ds-body-sm"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l8 4v6c0 5-3.4 7.9-8 10-4.6-2.1-8-5-8-10V6z" />
                </svg>
                Your admin console
              </Link>
            ) : null}
            {/* The only way back to the operator dashboard once the post-sign-in redirect has been
                spent — nothing else in the site's nav points at /operator. Gated on the role *and*
                the profile, exactly what `resolveOperatorAccess` requires, so this link can never
                offer a door that then bounces them to /login. */}
            {traveller.roles.includes("OPERATOR") && traveller.operatorProfile ? (
              <Link
                href="/operator"
                className="acct__row ds-body-sm"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 20h18M5 20V9l7-5 7 5v11" />
                  <path d="M10 20v-5h4v5" />
                </svg>
                Your operator dashboard
              </Link>
            ) : null}
            {/* Same reasoning, same gate shape, for /partner — resolvePartnerAccess requires the
                role and a profile row, same as the operator link above. */}
            {traveller.roles.includes("PARTNER") && traveller.partnerProfile ? (
              <Link
                href="/partner-portal"
                className="acct__row ds-body-sm"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0z" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
                </svg>
                Your partner dashboard
              </Link>
            ) : null}
            {/* Every signed-in account gets this: `/account` shows only what belongs to the
                session's own id, and the operator-only accounts minted by `createManualOperator`
                have genuine booking history too. Gating it on the TRAVELLER role would hide a
                person's own trips from them — see `requireSignedInOrRedirect`. */}
            <Link
              href="/account"
              className="acct__row ds-body-sm"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16v13H4z" />
                <path d="M4 10h16M9 3v4M15 3v4" />
              </svg>
              Your trips
            </Link>
            <Link href="/" className="acct__row ds-body-sm" role="menuitem" onClick={() => setOpen(false)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M15 9l-4.2 1.8L9 15l4.2-1.8z" />
              </svg>
              Discover trips
            </Link>
            <Link href="/conservation" className="acct__row ds-body-sm" role="menuitem" onClick={() => setOpen(false)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 14c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" />
                <path d="M12 4c2 2.5 2 5 0 7-2-2-2-4.5 0-7z" />
              </svg>
              Where the 5% goes
            </Link>
            <button
              type="button"
              className="acct__row acct__row--out ds-body-sm"
              role="menuitem"
              onClick={onSignOut}
              disabled={signingOut}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 17l5-5-5-5M20 12H9M12 4H5v16h7" />
              </svg>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
