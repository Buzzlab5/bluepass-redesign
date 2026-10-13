"use client";

import { useRef } from "react";
import { gsap, useGSAP, reduced } from "@/lib/gsap";
import { heroImage } from "@/lib/data";
import ParallaxMedia from "./ui/ParallaxMedia";
import { MaskLines, Rail } from "./ui/Text";
import Button from "./ui/Button";

const SCRIM = 0.6; // heroScrimStrength default from the design's prop schema
const WHATSAPP_HREF = "https://wa.me/628213143343";

export default function Hero() {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || reduced()) return;

      const eyebrow = el.querySelector(".hero__eyebrow");
      const copy = el.querySelector(".hero__copy");
      const ctas = el.querySelector(".hero__ctas");
      const note = el.querySelector(".hero__note");

      /* ---- load ------------------------------------------------------ */
      const tl = gsap.timeline({ delay: 0.25 });
      tl.from(eyebrow, { opacity: 0, y: 20, duration: 1 }, 0.45)
        // headline handles itself (MaskLines mode="load", delay 0.7)
        .from(copy, { opacity: 0, y: 26, duration: 1.1 }, 1.35)
        .from(
          ctas ? Array.from(ctas.children) : [],
          { opacity: 0, y: 22, duration: 1, stagger: 0.09 },
          1.5,
        )
        .from(note, { opacity: 0, duration: 1 }, 1.75);

      /* ---- scroll-out: content lifts and dissolves ------------------- */
      gsap
        .timeline({
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "bottom top",
            scrub: 0.6,
          },
        })
        .to(".hero__content", { y: -110, opacity: 0, ease: "none" }, 0);
    },
    { scope: ref },
  );

  return (
    <section
      ref={ref}
      className="section hero"
      style={{
        minHeight: "min(800px, 100svh)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ParallaxMedia
        src={heroImage}
        alt="Aerial view of a marina and coastline at dusk, surf, sail and dive country"
        strength={18}
        intro
        priority
      />
      {/* One static scrim, exactly as the Discover/Conservation/Partners heroes
          do it. The home hero used to stack a second full-bleed layer here (an
          animated dim) plus a centre scroll cue on its own compositing layer;
          under the nav's backdrop-filter those extra layers left a vertical
          seam across the pill that the other pages never showed. */}
      <div
        className="hero__scrim"
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, rgba(10,10,9,${(SCRIM * 0.35).toFixed(2)}) 0%, rgba(10,10,9,${(
            SCRIM * 0.22
          ).toFixed(2)}) 40%, rgba(10,10,9,${SCRIM}) 100%)`,
        }}
      />

      <div
        className="hero__content"
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 26,
          padding: "clamp(120px, 14vw, 160px) clamp(20px, 4.4vw, 64px)",
          maxWidth: 920,
        }}
      >
        <span
          className="hero__eyebrow ds-caption"
          style={{
            color: "rgba(255,255,255,0.7)",
            textTransform: "uppercase",
            letterSpacing: 3,
          }}
        >
          Surf · Sail · Dive
        </span>

        <MaskLines
          as="h1"
          className="ds-display-xl"
          lines={["Book the ocean.", "Leave it better."]}
          mode="load"
          delay={0.7}
          stagger={0.14}
        />

        <p
          className="hero__copy ds-body-lg"
          style={{ color: "rgba(255,255,255,0.75)", maxWidth: 560 }}
        >
          Vetted operators for surf, sail and dive, at the same price as
          booking direct.
        </p>

        <div
          className="hero__ctas"
          style={{
            display: "flex",
            gap: 12,
            marginTop: 6,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Button variant="primary" large onClick={() => window.location.assign("/")}>
            Explore trips
          </Button>
          {/* The pill lives in the root layout, so this asks for it by event
              rather than reaching across the tree. */}
          <Button
            variant="translucent"
            large
            onClick={() => window.dispatchEvent(new Event("kai:open"))}
          >
            Ask Kai →
          </Button>
        </div>

        <span
          className="hero__note ds-micro"
          style={{ color: "rgba(255,255,255,0.55)", marginTop: 6 }}
        >
          Live now in Australia:{" "}
          <a
            className="hero__note-link"
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noreferrer"
          >
            continue on WhatsApp
          </a>
        </span>
      </div>

      <Rail label="The promise" />
    </section>
  );
}
