"use client";

import Image from "next/image";
import { useRef } from "react";
import { gsap, useGSAP, reduced } from "@/lib/gsap";
import { boats } from "@/lib/data";
import { MaskLines, Words, Rail } from "./ui/Text";
import Button from "./ui/Button";

export default function ExploreSection() {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || reduced()) return;

      const cards = gsap.utils.toArray<HTMLElement>(".boat", el);

      cards.forEach((card, i) => {
        const frame = card.querySelector(".boat__frame");
        const img = card.querySelector(".boat__img");
        const meta = card.querySelectorAll(".boat__meta > *");
        const chip = card.querySelector(".boat__chip");

        /* The frame unmasks from the bottom while the photo inside settles out
           of an over-scale — the two moving against each other is what gives
           the reveal its weight. */
        gsap
          .timeline({
            scrollTrigger: {
              trigger: ".boats__grid",
              start: "top 80%",
              once: true,
            },
          })
          .fromTo(
            frame,
            { clipPath: "inset(100% 0 0 0)" },
            {
              clipPath: "inset(0% 0 0 0)",
              duration: 1.2,
              ease: "bp-inOut",
              delay: i * 0.08,
            },
            0,
          )
          .fromTo(
            img,
            { scale: 1.35 },
            { scale: 1, duration: 1.6, ease: "bp-out" },
            i * 0.08,
          )
          .fromTo(
            chip,
            { opacity: 0, x: -12 },
            { opacity: 1, x: 0, duration: 0.7 },
            i * 0.08 + 0.5,
          )
          .fromTo(
            meta,
            { opacity: 0, y: 16 },
            { opacity: 1, y: 0, duration: 0.8, stagger: 0.05 },
            i * 0.08 + 0.45,
          );

        /* Hover: photo pushes in, the card body lifts, price row nudges forward.
           The lift lives on `.boat__inner` because `.boat` itself is owned by
           the scrub above — sharing `y` between the two would fight. */
        const inner = card.querySelector(".boat__inner");
        const enter = () => {
          gsap.to(img, {
            scale: 1.08,
            duration: 0.9,
            ease: "power3.out",
            overwrite: "auto",
          });
          gsap.to(inner, {
            y: -10,
            duration: 0.5,
            ease: "power3.out",
            overwrite: "auto",
          });
          gsap.to(card.querySelector(".boat__price"), {
            x: 6,
            duration: 0.5,
            ease: "power3.out",
          });
          gsap.to(chip, {
            backgroundColor: "rgba(255,255,255,0.92)",
            color: "#0a0a09",
            duration: 0.4,
          });
        };
        const leave = () => {
          gsap.to(img, {
            scale: 1,
            duration: 0.9,
            ease: "power3.out",
            overwrite: "auto",
          });
          gsap.to(inner, {
            y: 0,
            duration: 0.5,
            ease: "power3.out",
            overwrite: "auto",
          });
          gsap.to(card.querySelector(".boat__price"), {
            x: 0,
            duration: 0.5,
            ease: "power3.out",
          });
          gsap.to(chip, {
            backgroundColor: "rgba(10,10,9,0.65)",
            color: "#ffffff",
            duration: 0.4,
          });
        };
        card.addEventListener("pointerenter", enter);
        card.addEventListener("pointerleave", leave);
      });

      /* A gentle scroll-linked stagger: alternate columns drift at slightly
         different speeds so the row breathes instead of scrolling as a slab.
         Only at the full five-across layout — once the grid wraps, neighbouring
         cards sit above each other and any vertical drift reads as overlap. */
      gsap.matchMedia().add("(min-width: 1241px)", () => {
        cards.forEach((card, i) => {
          const dir = i % 2 === 0 ? 1 : -1;
          gsap.fromTo(
            card,
            { y: dir * 14 },
            {
              y: dir * -14,
              ease: "none",
              scrollTrigger: {
                trigger: ".boats__grid",
                start: "top bottom",
                end: "bottom top",
                scrub: 1,
              },
            },
          );
        });
      });

      gsap.from(".boats__cta", {
        opacity: 0,
        y: 24,
        duration: 1,
        scrollTrigger: { trigger: ".boats__cta", start: "top 92%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className="section section--gap shell pad-y boats--lead">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <MaskLines
          lines={["Real boats. Real reefs.", "Live availability."]}
          className="ds-display-lg"
          style={{ textAlign: "center" }}
        />
        <Words
          className="ds-body"
          text="A small network of vetted ocean operators, booked at the price you see."
          style={{
            color: "var(--color-ink-muted)",
            textAlign: "center",
            marginTop: 12,
            maxWidth: 560,
          }}
        />
      </div>

      <div className="boats__grid">
        {boats.map((boat) => (
          <article
            key={boat.img}
            className="boat"
            style={{ willChange: "transform" }}
          >
            <div
              className="boat__inner"
              style={{
                display: "flex",
                flexDirection: "column",
                willChange: "transform",
              }}
            >
              <div
                className="boat__frame"
                style={{
                  position: "relative",
                  aspectRatio: "4 / 5",
                  borderRadius: "var(--radius-lg)",
                  overflow: "hidden",
                  background: "var(--color-surface-1)",
                }}
              >
                <div
                  className="boat__img"
                  style={{
                    position: "absolute",
                    inset: 0,
                    willChange: "transform",
                  }}
                >
                  <Image
                    src={boat.imgSrc}
                    alt={`${boat.name}, ${boat.loc}`}
                    fill
                    sizes="(max-width: 780px) 50vw, (max-width: 1240px) 33vw, 20vw"
                    style={{ objectFit: "cover" }}
                  />
                </div>
                <span
                  className="boat__chip ds-micro"
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    padding: "5px 10px",
                    background: "rgba(10,10,9,0.65)",
                    borderRadius: "var(--radius-pill)",
                    color: "#ffffff",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    pointerEvents: "none",
                  }}
                >
                  {boat.loc}
                </span>
              </div>

              <div className="boat__meta">
                <div
                  className="ds-headline"
                  style={{ marginTop: 14, fontSize: 18 }}
                >
                  {boat.name}
                </div>
                <div
                  className="ds-body-sm"
                  style={{ color: "var(--color-ink-muted)", marginTop: 4 }}
                >
                  {boat.guests}
                </div>
                <div
                  style={{
                    borderTop: "1px solid var(--color-hairline-soft)",
                    margin: "12px 0",
                  }}
                />
                <div
                  className="boat__price"
                  style={{ display: "flex", alignItems: "baseline", gap: 6 }}
                >
                  {/* Some operators publish no rate card. Saying so is better than
                    printing a number nobody can hold them to. */}
                  {boat.price ? (
                    <>
                      <span
                        className="ds-body-sm"
                        style={{ color: "var(--color-ink)", fontWeight: 700 }}
                      >
                        from {boat.price}
                      </span>
                      <span
                        className="ds-micro"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        {boat.unit}
                      </span>
                    </>
                  ) : (
                    <span
                      className="ds-body-sm"
                      style={{ color: "var(--color-ink)", fontWeight: 700 }}
                    >
                      Price on request
                    </span>
                  )}
                </div>
                <div
                  className="ds-micro"
                  style={{ color: "var(--color-ink-muted)", marginTop: 4 }}
                >
                  {boat.sub}
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div
        className="boats__cta"
        style={{ display: "flex", justifyContent: "center", marginTop: 44 }}
      >
        <Button variant="translucent" large onClick={() => window.location.assign("/")}>
          Explore all trips
        </Button>
      </div>

      <Rail label="Charters" tone="dark" />
    </section>
  );
}
