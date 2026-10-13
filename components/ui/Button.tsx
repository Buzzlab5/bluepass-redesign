"use client";

import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, reduced } from "@/lib/gsap";

type Variant = "primary" | "secondary" | "translucent";

/**
 * The design-system Button (`components/buttons/Button.jsx`) — same three
 * variants, same token geometry, same scale-0.96 press signature. Motion added
 * on top: a colour wipe that sweeps up from the bottom edge on hover and a
 * light magnetic pull toward the cursor.
 *
 * The pointer listeners live on a wrapper that never moves, while the magnetic
 * transform is applied to the button inside it. Listening on the moving element
 * makes it chase itself out from under the cursor, which fires enter/leave in
 * pairs that don't match and leaves the wipe stranded mid-sweep.
 *
 * The label colour is swapped by an `is-hover` class with a CSS transition, not
 * by GSAP — the resting colour is `var(--color-on-primary)`, and a custom
 * property is not something GSAP's colour parser can interpolate towards.
 */
export default function Button({
  variant = "primary",
  children,
  className = "",
  large,
  onClick,
  magnetic = true,
  type = "button",
  name,
  value,
  disabled,
  href,
  target,
}: {
  variant?: Variant;
  children: ReactNode;
  className?: string;
  large?: boolean;
  onClick?: () => void;
  magnetic?: boolean;
  /**
   * `submit` lets this drive a `<form action={serverAction}>` — with `name` and
   * `value` set, which button was pressed arrives in the FormData. That is how
   * the approvals queue puts Approve and Decline on one form without a client
   * round-trip in between.
   */
  type?: "button" | "submit";
  name?: string;
  value?: string;
  disabled?: boolean;
  /** Renders a link that looks like the button, for when pressing it goes somewhere. */
  href?: string;
  target?: "_blank";
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const wrap = wrapRef.current;
      if (!wrap || reduced()) return;

      const btn = wrap.querySelector<HTMLElement>("button, a");
      const wipe = wrap.querySelector(".btn__wipe");
      if (!btn) return;

      // The wipe parks off-stage via a CSS `translateY(101%)`, which GSAP reads
      // back as a pixel `y` offset rather than as `yPercent`. Left alone, that
      // stale px component adds to every yPercent tween and inverts the whole
      // sweep — covering the button at rest and uncovering it on hover. Restate
      // the same resting position purely in yPercent before animating it.
      gsap.set(wipe, { yPercent: 101, y: 0 });

      const xTo = gsap.quickTo(btn, "x", { duration: 0.5, ease: "power3.out" });
      const yTo = gsap.quickTo(btn, "y", { duration: 0.5, ease: "power3.out" });

      // Wipe sweeps in from below and back out through the top, so the motion
      // reads as one continuous direction rather than a rubber-band.
      const enter = () => {
        btn.classList.add("is-hover");
        gsap.fromTo(
          wipe,
          { yPercent: 101 },
          { yPercent: 0, duration: 0.5, ease: "bp-out", overwrite: true },
        );
      };
      const leave = () => {
        btn.classList.remove("is-hover");
        gsap.to(wipe, { yPercent: -101, duration: 0.45, ease: "bp-out", overwrite: true });
        xTo(0);
        yTo(0);
      };
      const move = (e: PointerEvent) => {
        if (!magnetic) return;
        const r = wrap.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.25);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.3);
      };
      const down = () => gsap.to(btn, { scale: 0.96, duration: 0.15, ease: "power2.out" });
      const up = () => gsap.to(btn, { scale: 1, duration: 0.35, ease: "back.out(2)" });

      wrap.addEventListener("pointerenter", enter);
      wrap.addEventListener("pointerleave", leave);
      wrap.addEventListener("pointermove", move);
      wrap.addEventListener("pointerdown", down);
      wrap.addEventListener("pointerup", up);

      return () => {
        wrap.removeEventListener("pointerenter", enter);
        wrap.removeEventListener("pointerleave", leave);
        wrap.removeEventListener("pointermove", move);
        wrap.removeEventListener("pointerdown", down);
        wrap.removeEventListener("pointerup", up);
      };
    },
    { scope: wrapRef, dependencies: [variant, magnetic] },
  );

  const classes = `btn btn--${variant} ${large ? "btn--lg" : ""} ${className}`;

  if (href) {
    return (
      <span ref={wrapRef} className="btn-magnet">
        <a
          href={href}
          className={classes}
          onClick={onClick}
          {...(target === "_blank" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          <span className="btn__wipe" aria-hidden />
          <span className="btn__label">{children}</span>
        </a>
      </span>
    );
  }

  return (
    <span ref={wrapRef} className="btn-magnet">
      <button
        type={type}
        name={name}
        value={value}
        disabled={disabled}
        onClick={onClick}
        className={classes}
      >
        <span className="btn__wipe" aria-hidden />
        <span className="btn__label">{children}</span>
      </button>
    </span>
  );
}
