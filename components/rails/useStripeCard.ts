"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A card field from Stripe.js, for trips whose booking system charges the card itself.
 *
 * The card number goes from the traveller's browser straight to Stripe, under the
 * publishable key it is given, and comes back as a single-use token. For a Rezdy trip
 * on automated payments that key is Rezdy's, so the token lives on Rezdy's Stripe
 * account and only Rezdy can charge it. Bluepass's servers see the token, never the card.
 */

type StripeCardElement = {
  mount: (el: HTMLElement) => void;
  destroy: () => void;
  on: (event: string, handler: (e: { complete?: boolean; error?: { message?: string } }) => void) => void;
};
type StripeLike = {
  elements: (options?: object) => { create: (type: "card", options?: object) => StripeCardElement };
  createToken: (card: StripeCardElement, data?: { name?: string }) => Promise<{ token?: { id: string }; error?: { message?: string } }>;
};
/** Stripe.js on the page, typed only as far as this hook uses it (KaiPanel declares its own view of it). */
function stripeGlobal() {
  return (window as unknown as { Stripe?: (key: string) => StripeLike }).Stripe;
}

let loading: Promise<void> | null = null;

function loadStripe(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (stripeGlobal()) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { loading = null; reject(new Error("Stripe did not load")); };
      document.head.appendChild(script);
    });
  }
  return loading;
}

const STYLE = {
  base: {
    color: "#0f0f0f",
    fontFamily: "-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', sans-serif",
    fontSize: "16px",
    "::placeholder": { color: "#8a8a8a" },
  },
  invalid: { color: "#b42318", iconColor: "#b42318" },
};

export function useStripeCard(publishableKey: string | null) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [complete, setComplete] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stripe = useRef<StripeLike | null>(null);
  const card = useRef<StripeCardElement | null>(null);

  useEffect(() => {
    if (!publishableKey || !el) return;
    let cancelled = false;
    loadStripe()
      .then(() => {
        const Stripe = stripeGlobal();
        if (cancelled || !Stripe) return;
        stripe.current = Stripe(publishableKey);
        const element = stripe.current.elements().create("card", { hidePostalCode: true, style: STYLE });
        element.on("change", (e) => { setComplete(Boolean(e.complete)); setError(e.error?.message ?? null); });
        element.on("focus", () => setFocused(true));
        element.on("blur", () => setFocused(false));
        element.mount(el);
        card.current = element;
      })
      .catch(() => !cancelled && setError("The card field did not load. Check your connection and refresh the page."));
    return () => {
      cancelled = true;
      card.current?.destroy();
      card.current = null;
      setComplete(false);
    };
  }, [publishableKey, el]);

  const mount = useCallback((node: HTMLDivElement | null) => setEl(node), []);

  const tokenise = useCallback(async (name: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
    if (!stripe.current || !card.current) return { ok: false, error: "The card field is still loading. Try again in a moment." };
    const result = await stripe.current.createToken(card.current, { name });
    if (result.token?.id) return { ok: true, token: result.token.id };
    return { ok: false, error: result.error?.message ?? "That card was not accepted. Check the details and try again." };
  }, []);

  return { mount, complete, focused, error, tokenise };
}
