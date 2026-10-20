"use client";

import KaiQuestionControl from "@/components/KaiQuestionControl";
import type { KaiQuestionInput } from "@/lib/services/kai-core/question-input";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap, useGSAP, reduced } from "@/lib/gsap";
import { lockScroll, unlockScroll } from "@/lib/lenis";
import { useSession } from "./auth/SessionProvider";
import { stripDuplicatedProductList } from "@/lib/services/kai-core/reply-product-list";
import KaiMatchThumbPlaceholder from "./KaiMatchThumbPlaceholder";
import KaiDateCalendar from "./KaiDateCalendar";

/* Shapes transcribed from `app/api/kai/web-chat/route.ts`. */
type Suggested = { label: string; message: string };
type Region = "indonesia" | "australia";

/** A real, still-unpaid checkout left behind by "Start a new conversation" - see
 * forceNewSessionRef below. Not a Suggested chip: "Continue my order" has to switch the panel back
 * to conversationId's own history, which a plain send(message) can't do. */
type UnfinishedOrder = {
  conversationId: string;
  productTitle: string;
  dateText: string;
  guests: number;
  grossAmountCents: number;
  currency: string;
};

/**
 * A card Kai attached to a reply - either a BluePass yacht match (Indonesia) or an AU/Boattime
 * product card (kai-conversation-flow-notes.md item 9). The BluePass-only fields (region, tier,
 * cabins, maxGuests, pricePerCabin/charterPrice, heroImageUrl) are optional because Boattime cards
 * carry none of them - no photo source exists today and the user decided not to build one. `priceLabel`
 * is the AU-side price (null until a date is known); BluePass cards don't set it, so the price line
 * falls back to the existing per-cabin/charter fields for them.
 */
type Match = {
  slug: string;
  name: string;
  region?: string;
  tier?: string;
  maxGuests?: number;
  cabins?: number;
  pricePerCabin?: string;
  charterPrice?: string | null;
  priceLabel?: string | null;
  dateChecked?: boolean;
  matchingReasons: string[];
  productUrl: string | null;
  heroImageUrl?: string;
};

type ContactRequest = {
  conversationId: string;
  fields: ["name", "email", "phone"];
  status: "CONTACT_DETAILS_REQUIRED";
};

type PaymentRequest = {
  conversationId: string;
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
  checkoutUrl: string | null;
  status: "PAYMENT_PENDING";
};

type PaymentIntent = {
  provider: string;
  publishableKey: string;
  conversationId: string;
};

type TimeOption = { label: string };
type TicketOption = { label: string; unitPriceCents: number };
type ExtraOption = { label: string; unitPriceCents: number };

type Msg = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  matches?: Match[];
};

/* Minimal surface of Stripe.js — loaded from the CDN at runtime, never bundled. */
type StripeCardElement = { mount: (selector: string) => void; unmount?: () => void };
type StripeLike = {
  elements: () => { create: (kind: "card", opts: { hidePostalCode: boolean }) => StripeCardElement };
  createToken: (
    el: StripeCardElement,
    data: { name?: string },
  ) => Promise<{ error?: { message?: string }; token?: { id?: string } }>;
};
declare global {
  interface Window {
    Stripe?: (key: string) => StripeLike;
  }
}

const SESSION_KEY = "bp_kai_session";
const LOG_KEY = "bp_kai_log";
/** The route accepts at most 12 items of context. */
const CONTEXT_MAX = 12;
/** Same real contact link as Hero.tsx's CTA - kai-conversation-flow-notes.md finding #17: the old
 * error copy offered WhatsApp with no link at all. */
const WHATSAPP_HREF = "https://wa.me/628213143343";
/** Tenant flag: when set, the payment step is a hosted checkout redirect, not a card form. */
const HOSTED_CHECKOUT_FEATURE = "bluepass_stripe_pms_checkout";

/**
 * Kai sends payment links as plain text inside its reply (e.g. the Stripe checkout URL for a
 * hosted-checkout tenant) - rendered as real, shortened links so a 300-character URL doesn't wrap
 * across the whole bubble as raw text. Mirrors boattimeyachtcharters-redesign's KaiWidget, which
 * has the same problem for the same reason (both read a reply straight from Kai's /api/widget
 * /messages route). New tab, since this chat only lives in memory - navigating away would lose it.
 */
const URL_PATTERN = /(https?:\/\/[^\s]*[^\s.,;:!?)\]])/g;

/** Checkout URLs run to 300+ characters; showing them raw buries the message. */
function linkLabel(url: string) {
  if (url.length <= 48) return url;
  try {
    return `${new URL(url).hostname}/…`;
  } catch {
    return `${url.slice(0, 45)}…`;
  }
}

function withLinks(text: string) {
  return text.split(URL_PATTERN).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} className="kmsg__link" href={part} target="_blank" rel="noopener noreferrer">
        {linkLabel(part)}
      </a>
    ) : (
      part
    ),
  );
}

/* Names no region, so it never goes stale as operators come and go. Shown at once,
   then replaced by buildOpener() as soon as the live catalog's regions land.
   kai-conversation-flow-notes.md's greeting rewrite: the panel header already says
   "Kai · Bluepass concierge" and the visitor just clicked a button labelled "Ask
   Kai", so the old self-description was the third impression, not the first. The
   5% line is already on the hero, every trip tile, and the "How booking works"
   section - repeating it here was the fourth. It now surfaces once, attached to a
   real price, from Kai's own grounded reply (see buildBluePassValueReply /
   buildBluePassConservationReply in Kai core) - not as a greeting preamble. */
const OPENER = "Hi, I'm Kai. Where do you want to go?";

/**
 * Narrates whatever regions the catalog actually has today — the same source of
 * truth Kai's own reply engine uses — rather than a hardcoded destination list
 * that silently goes stale the moment a new region's operators go live. A
 * "Somewhere else" chip always rides alongside the real regions: per
 * kai-conversation-flow-notes.md finding #2, Kai must never make the one region it
 * can actually transact today read like the only option that exists.
 */
function buildOpener(regions: string[]): { content: string; suggested: Suggested[] } {
  const shortlist = regions.slice(0, 3);
  const regionChips: Suggested[] = shortlist.map((region) => ({
    label: `${region} · live availability`,
    message: `I'm looking for a trip in ${region}`,
  }));

  return {
    content: OPENER,
    suggested: [...regionChips, { label: "Somewhere else", message: "Somewhere else - what do you have?" }],
  };
}

function loadStripeScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Secure payment can only start in a browser."));
  }
  if (window.Stripe) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://js.stripe.com/v3/"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Secure payment could not load.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Secure payment could not load."));
    document.head.appendChild(script);
  });
}

/**
 * The Ask Kai conversation.
 *
 * Anchored to the pill it opens from rather than centred: the visitor is mid-page
 * and mid-thought, and a full-screen takeover on desktop would throw away the
 * context they were reading. Below 620px it does go full-screen, because a
 * 380px panel inside a 390px viewport is just a worse full screen.
 *
 * The route can answer with more than prose — matched yachts, a request for contact
 * details, or a payment step. Each of those is rendered here in the redesign's own
 * design language; only the sequence and field names come from the shared backend.
 */
export default function KaiPanel({
  open,
  onClose,
  initialMessage,
  onInitialMessageSent,
}: {
  open: boolean;
  onClose: () => void;
  /** Set by a caller that already knows what the traveller wants - e.g. TripSheet's "Request this
   * trip" - so the panel opens straight into that request instead of a blank thread. */
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
}) {
  const { traveller } = useSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closingRef = useRef(false);
  const seqRef = useRef(0);
  /* Region is decided by Kai Core on the first message and must ride along on every
     follow-up call, including payment — it selects the tenant. */
  const regionRef = useRef<Region | undefined>(undefined);
  /* Set by resetThread, consumed by the very next send() and cleared immediately after - tells the
     server this session must be a real fresh conversation, not Kai Core's own "resume-or-create"
     behaviour for a signed-in traveller (see createKaiCoreSession in kai-core/client.ts), which
     otherwise silently reattaches the account's last conversation and defeats "Start a new
     conversation" for anyone signed in. */
  const forceNewSessionRef = useRef(false);
  const stripeRef = useRef<StripeLike | null>(null);
  const cardElementRef = useRef<StripeCardElement | null>(null);
  /* Cached so "new conversation" reopens with the same destination-aware opener
     rather than falling back to the generic one. */
  const regionsRef = useRef<string[]>([]);

  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [suggested, setSuggested] = useState<Suggested[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);

  const [contactRequest, setContactRequest] = useState<ContactRequest | null>(null);
  const [questionInput, setQuestionInput] = useState<KaiQuestionInput | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "" });
  const [contactError, setContactError] = useState<string | null>(null);

  /* Generic-booking-flow (AU/Rezdy) choice prompts - same "latch-style" pattern as
     contactRequest/paymentRequest above: absent in a reply means that step is no longer pending. */
  const [dateOptions, setDateOptions] = useState<string[] | null>(null);
  const [timeOptions, setTimeOptions] = useState<TimeOption[] | null>(null);
  const [ticketOptions, setTicketOptions] = useState<TicketOption[] | null>(null);
  const [extraOptions, setExtraOptions] = useState<ExtraOption[] | null>(null);

  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "starting" | "ready" | "confirming">(
    "idle",
  );
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [cardholder, setCardholder] = useState("");
  const [hostedCheckout, setHostedCheckout] = useState(false);

  const [unfinishedOrder, setUnfinishedOrder] = useState<UnfinishedOrder | null>(null);
  const [resumingOrder, setResumingOrder] = useState(false);

  useEffect(() => setMounted(true), []);

  /* Restore the thread so closing the panel isn't the same as ending the chat. */
  useEffect(() => {
    try {
      const storedId = window.localStorage.getItem(SESSION_KEY) ?? undefined;
      const storedLog = window.localStorage.getItem(LOG_KEY);
      if (storedId) setSessionId(storedId);
      if (storedLog) {
        const parsed = JSON.parse(storedLog) as Msg[];
        if (Array.isArray(parsed) && parsed.length) {
          seqRef.current = parsed.length;
          setMessages(parsed);
          return;
        }
      }
    } catch {
      /* A cleared or blocked localStorage just means we start fresh. */
    }
    seqRef.current = 1;
    setMessages([{ id: 0, role: "assistant", content: OPENER }]);
  }, []);

  /* Swap in the destination-aware opener once the catalog's regions land. Guarded so it
     never overwrites a thread the traveller has already started. */
  useEffect(() => {
    let active = true;

    fetch("/api/kai/regions")
      .then((r) => (r.ok ? r.json() : { regions: [] }))
      .then((data: { regions?: string[] }) => {
        if (!active) return;
        regionsRef.current = data.regions ?? [];
        const built = buildOpener(regionsRef.current);
        if (!built.suggested.length) return;
        setMessages((current) =>
          current.length === 1 && current[0].role === "assistant"
            ? [{ id: current[0].id, role: "assistant", content: built.content }]
            : current,
        );
        setSuggested((current) => (current.length ? current : built.suggested));
      })
      .catch(() => {
        /* No regions endpoint, no problem — the generic opener already stands. */
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    try {
      window.localStorage.setItem(LOG_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* Non-fatal — the thread just won't survive a reload. */
    }
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;
    try {
      window.localStorage.setItem(SESSION_KEY, sessionId);
    } catch {
      /* As above. */
    }
  }, [sessionId]);

  /* Full-screen on small viewports is the only case that needs the page frozen. */
  useEffect(() => {
    if (!open) return;
    closingRef.current = false;
    const fullScreen = window.matchMedia("(max-width: 620px)").matches;
    if (fullScreen) lockScroll();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 420);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      if (fullScreen) unlockScroll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scrollToEnd = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced() ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => scrollToEnd(false));
  }, [open, scrollToEnd]);

  useEffect(() => {
    if (open) scrollToEnd();
  }, [
    messages,
    thinking,
    contactRequest,
    paymentRequest,
    dateOptions,
    timeOptions,
    ticketOptions,
    extraOptions,
    open,
    scrollToEnd,
  ]);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = rootRef.current;
    if (!el || reduced()) {
      onClose();
      return;
    }
    gsap
      .timeline({ onComplete: onClose })
      .to(el.querySelector(".kpanel__shell"), {
        opacity: 0,
        y: 20,
        scale: 0.97,
        duration: 0.28,
        ease: "power2.in",
        transformOrigin: "bottom right",
      })
      .to(el.querySelector(".kpanel__veil"), { opacity: 0, duration: 0.25 }, 0);
  };

  /* Entrance grows out of the pill's own corner, so the panel reads as the pill
     unfolding rather than a separate window arriving. */
  useGSAP(
    () => {
      const el = rootRef.current;
      if (!el || !open || reduced()) return;
      gsap
        .timeline()
        .fromTo(el.querySelector(".kpanel__veil"), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0)
        .fromTo(
          el.querySelector(".kpanel__shell"),
          { opacity: 0, y: 26, scale: 0.94, transformOrigin: "bottom right" },
          { opacity: 1, y: 0, scale: 1, duration: 0.62, ease: "bp-out" },
          0.04,
        )
        .fromTo(
          el.querySelectorAll(".kmsg"),
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, stagger: 0.05 },
          0.22,
        );
    },
    { dependencies: [open] },
  );

  const push = (role: Msg["role"], content: string, matches?: Match[]) => {
    const id = seqRef.current++;
    setMessages((m) => [...m, { id, role, content, ...(matches?.length ? { matches } : {}) }]);
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || thinking) return;

    push("user", message);
    setDraft("");
    setSuggested([]);
    setQuestionInput(null);
    setContactError(null);
    setThinking(true);

    const context = messages
      .filter((m) => m.role !== "system")
      .slice(-CONTEXT_MAX)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    try {
      const forceNewSession = forceNewSessionRef.current;
      forceNewSessionRef.current = false;

      const res = await fetch("/api/kai/web-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          ...(sessionId ? { sessionId } : {}),
          ...(regionRef.current ? { region: regionRef.current } : {}),
          ...(context.length ? { recentMessages: context } : {}),
          ...(forceNewSession ? { forceNewSession: true } : {}),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        region?: Region;
        reply?: string;
        matches?: Match[];
        suggestedReplies?: Suggested[];
        contactRequest?: ContactRequest | null;
        paymentRequest?: PaymentRequest | null;
        questionInput?: KaiQuestionInput | null;
        dateOptions?: string[] | null;
        timeOptions?: TimeOption[] | null;
        ticketOptions?: TicketOption[] | null;
        extraOptions?: ExtraOption[] | null;
        unfinishedOrder?: UnfinishedOrder | null;
        error?: string;
      };

      if (!res.ok || !data.reply) {
        /* The most likely cause is the Kai Core bridge being unreachable, which
           is a deployment/config state — say so plainly instead of pretending
           Kai answered. kai-conversation-flow-notes.md finding #17: the old copy
           said "booking brain" (an internal module name, meaningless to a
           traveller) and offered WhatsApp with no actual link to tap or copy. */
        push(
          "system",
          `I'm having trouble reaching availability right now. Nothing you typed was lost. Try again, or message us on WhatsApp: ${WHATSAPP_HREF}`,
        );
        return;
      }

      if (data.sessionId) setSessionId(data.sessionId);
      if (data.region) regionRef.current = data.region;
      /* Kai's reply repeats the products as a numbered list *and* returns them as cards. Now that
         each card has its own "Select this", that list is a second, unclickable copy of the same
         options directly above the real ones — so it is dropped whenever the cards are shown. The
         text keeps it for surfaces that cannot draw cards (WhatsApp shares this reply). */
      push(
        "assistant",
        stripDuplicatedProductList(data.reply, (data.matches ?? []).map((match) => match.name)),
        data.matches,
      );
      setSuggested(Array.isArray(data.suggestedReplies) ? data.suggestedReplies.slice(0, 4) : []);

      /* Only ever present on the one reply that just created a forced-fresh conversation - see
         forceNewSessionRef. A separate message (not folded into the reply above) so it reads as
         Kai flagging something, not as part of whatever the traveller just asked. */
      if (data.unfinishedOrder) {
        const o = data.unfinishedOrder;
        setUnfinishedOrder(o);
        push(
          "assistant",
          `Before we go further — you still have an unfinished order: ${o.productTitle} on ${o.dateText} for ${o.guests} guest${o.guests === 1 ? "" : "s"}. Want to continue that order, or keep going with this new chat?`,
        );
      }

      /* Both are latch-style: absent in a reply means that step is no longer pending. */
      setContactRequest(data.contactRequest ?? null);
      // Only while Kai is waiting on that answer: a contact form or a payment takes the place of it.
      setQuestionInput(data.contactRequest || data.paymentRequest ? null : (data.questionInput ?? null));
      if (!data.contactRequest) {
        setContactForm({ name: "", email: "", phone: "" });
      } else if (traveller) {
        /* A signed-in traveller already told us this once at registration - Kai asking again is a
           form to confirm and correct, not one to fill from scratch. Blank fields fall back to
           whatever's typed already rather than overwriting it. */
        setContactForm((f) => ({
          name: f.name || traveller.name || "",
          email: f.email || traveller.email || "",
          phone: f.phone || traveller.phone || "",
        }));
      }
      setPaymentRequest(data.paymentRequest ?? null);
      setDateOptions(data.dateOptions ?? null);
      setTimeOptions(data.timeOptions ?? null);
      setTicketOptions(data.ticketOptions ?? null);
      setExtraOptions(data.extraOptions ?? null);
    } catch {
      push("system", "That didn’t send. Check your connection and try again.");
    } finally {
      setThinking(false);
    }
  };

  /* A trip-sheet "Request this trip"/"Ask Kai" click already knows what the traveller wants -
     send it the moment the panel is actually open, rather than making them retype it into a
     thread that just opened blank. `onInitialMessageSent` clears the caller's state so this
     never re-fires on a later open with stale state still hanging around. */
  useEffect(() => {
    if (!open || !initialMessage) return;
    void send(initialMessage);
    onInitialMessageSent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialMessage]);

  /* ---- contact details -------------------------------------------------
     Kai asks for these in prose; the form just spares the visitor from typing
     three things into a chat box. It answers as a normal message, which is what
     the backend expects — there is no separate submit endpoint. */
  const submitContact = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = contactForm.name.trim();
    const email = contactForm.email.trim();
    const phone = contactForm.phone.trim();

    if (name.length < 2) {
      setContactError("Please enter your name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactError("Please enter a valid email.");
      return;
    }
    if (phone.replace(/\D/g, "").length < 6) {
      setContactError("Please enter a valid WhatsApp number.");
      return;
    }

    setContactError(null);
    void send(`My name is ${name}, email is ${email}, and WhatsApp number is ${phone}`);
  };

  /* ---- payment ---------------------------------------------------------
     Whether this tenant takes a card here or hands off to a hosted checkout is
     Kai Core's call, not ours — ask before rendering either. */
  useEffect(() => {
    setPaymentStatus("idle");
    setPaymentError(null);
    setPaymentIntent(null);
    setCardholder("");

    if (!paymentRequest) {
      setHostedCheckout(false);
      return;
    }

    let active = true;
    const region = regionRef.current ?? "indonesia";
    fetch(`/api/kai/web-chat/capabilities?region=${region}`)
      .then((r) => (r.ok ? r.json() : { enabledFeatures: [] }))
      .then((data: { enabledFeatures?: string[] }) => {
        if (active) setHostedCheckout(Boolean(data.enabledFeatures?.includes(HOSTED_CHECKOUT_FEATURE)));
      })
      .catch(() => {
        if (active) setHostedCheckout(false);
      });

    return () => {
      active = false;
    };
  }, [paymentRequest]);

  const startPayment = useCallback(async () => {
    if (!paymentRequest) return;
    try {
      setPaymentStatus("starting");
      setPaymentError(null);
      const res = await fetch("/api/kai/web-chat/payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: paymentRequest.conversationId,
          region: regionRef.current ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Secure payment is not available yet.");
      setPaymentIntent((await res.json()) as PaymentIntent);
    } catch (error) {
      setPaymentStatus("idle");
      setPaymentError(
        error instanceof Error ? error.message : "Secure payment is not available yet.",
      );
    }
  }, [paymentRequest]);

  /* The card field is Stripe's own iframe — it only ever mounts once an intent exists. */
  useEffect(() => {
    let active = true;

    async function mountCard() {
      if (!paymentIntent) return;
      try {
        setPaymentError(null);
        await loadStripeScript();
        if (!active) return;

        const stripe = window.Stripe?.(paymentIntent.publishableKey) ?? null;
        if (!stripe) throw new Error("Secure payment could not initialize.");

        const card = stripe.elements().create("card", { hidePostalCode: true });
        stripeRef.current = stripe;
        cardElementRef.current = card;
        card.mount("#kai-card-element");
        setPaymentStatus("ready");
      } catch (error) {
        if (!active) return;
        setPaymentStatus("idle");
        setPaymentError(
          error instanceof Error ? error.message : "Secure payment could not load.",
        );
      }
    }

    void mountCard();

    return () => {
      active = false;
      cardElementRef.current?.unmount?.();
      cardElementRef.current = null;
      stripeRef.current = null;
    };
  }, [paymentIntent]);

  const confirmPayment = useCallback(async () => {
    if (!paymentRequest || !paymentIntent || !stripeRef.current || !cardElementRef.current) return;
    try {
      setPaymentStatus("confirming");
      setPaymentError(null);

      const tokenResult = await stripeRef.current.createToken(cardElementRef.current, {
        name: cardholder.trim() || undefined,
      });
      if (tokenResult.error || !tokenResult.token?.id) {
        throw new Error(tokenResult.error?.message ?? "Card details could not be verified.");
      }

      const res = await fetch("/api/kai/web-chat/payment-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: paymentIntent.conversationId,
          cardToken: tokenResult.token.id,
          region: regionRef.current ?? undefined,
        }),
      });
      if (!res.ok) throw new Error("Payment could not be completed.");

      const confirmation = (await res.json()) as { externalBookingId: string };
      push(
        "assistant",
        `Payment received and your booking is confirmed. Confirmation reference: ${confirmation.externalBookingId}.`,
      );
      setPaymentRequest(null);
      setPaymentIntent(null);
      setPaymentStatus("idle");
    } catch (error) {
      setPaymentStatus("ready");
      setPaymentError(error instanceof Error ? error.message : "Payment could not be completed.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentRequest, paymentIntent, cardholder]);

  const resetThread = () => {
    try {
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(LOG_KEY);
    } catch {
      /* Nothing to clean up. */
    }
    setSessionId(undefined);
    regionRef.current = undefined;
    forceNewSessionRef.current = true;
    seqRef.current = 1;
    const built = buildOpener(regionsRef.current);
    setMessages([{ id: 0, role: "assistant", content: built.content }]);
    setSuggested(built.suggested);
    setContactRequest(null);
    setContactForm({ name: "", email: "", phone: "" });
    setContactError(null);
    setPaymentRequest(null);
    setUnfinishedOrder(null);
    inputRef.current?.focus();
  };

  /* "Continue my order" - unlike a Suggested chip, this can't just send a message into the current
     (fresh) conversation, since that conversation has no memory of the old order at all. Instead it
     switches the panel back to the old conversationId and its real history, via the account-wide
     resume endpoint (dormant until this feature needed it - see resumeKaiCoreSession/Kai's
     /api/kai/web-chat/resume, built for cross-device resume but never actually called from here
     before now). */
  const continueUnfinishedOrder = async () => {
    if (!unfinishedOrder || resumingOrder) return;
    setResumingOrder(true);
    try {
      const res = await fetch("/api/kai/web-chat/resume", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        resumed?: boolean;
        sessionId?: string;
        region?: Region;
        messages?: { role: "user" | "assistant"; content: string }[];
      };

      if (!res.ok || !data.resumed || !data.sessionId) {
        push(
          "system",
          `I couldn't pull that order back up. Try again, or message us on WhatsApp: ${WHATSAPP_HREF}`,
        );
        return;
      }

      setSessionId(data.sessionId);
      if (data.region) regionRef.current = data.region;
      const restored = (data.messages ?? []).map((m, i) => ({ id: i, role: m.role, content: m.content }) as Msg);
      seqRef.current = restored.length;
      setMessages(
        restored.length ? restored : [{ id: 0, role: "assistant", content: "Picking up where you left off." }],
      );
      setSuggested([]);
      setUnfinishedOrder(null);
    } catch {
      push(
        "system",
        `I couldn't pull that order back up. Try again, or message us on WhatsApp: ${WHATSAPP_HREF}`,
      );
    } finally {
      setResumingOrder(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div ref={rootRef} className="kpanel" role="dialog" aria-modal="true" aria-label="Chat with Kai">
      <button type="button" className="kpanel__veil" aria-label="Close chat" onClick={close} />

      <div className="kpanel__shell">
        <header className="kpanel__head">
          <span className="kpanel__id">
            <span className="kpanel__avatar" aria-hidden>
              K<span className="kpanel__dot" />
            </span>
            <span className="kpanel__id-text">
              <span className="ds-body-sm kpanel__name">Kai</span>
              <span className="ds-micro kpanel__status">
                {thinking ? "Typing…" : "Online · Bluepass concierge"}
              </span>
            </span>
          </span>

          <span className="kpanel__head-acts">
            <button
              type="button"
              className="kpanel__icon"
              onClick={resetThread}
              aria-label="Start a new conversation"
              title="New conversation"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12a8 8 0 0 1 13-6M20 4v4h-4M20 12a8 8 0 0 1-13 6M4 20v-4h4" />
              </svg>
            </button>
            <button type="button" className="kpanel__icon" onClick={close} aria-label="Close chat">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        </header>

        <div ref={scrollRef} className="kpanel__log" data-lenis-prevent>
          {traveller ? (
            <span className="ds-micro kpanel__who">
              Signed in as {traveller.name ?? traveller.email}. Kai can pick up your enquiries.
            </span>
          ) : null}

          {messages.map((m) => (
            <div key={m.id} className={`kmsg kmsg--${m.role}`}>
              {m.role === "assistant" ? (
                <span className="kmsg__mark" aria-hidden>
                  K
                </span>
              ) : null}
              <span className="kmsg__bubble ds-body-sm">
                {/* Wrapped so the cards can be spaced off real text. `{m.content}` alone is a text
                    node, and a text node is not an element — `.kmatches:first-child` therefore
                    matched even when prose was present, which is what collapsed the gap. */}
                {m.content ? <span className="kmsg__text">{withLinks(m.content)}</span> : null}

                {m.matches?.length ? (
                  <span className="kmatches">
                    {m.matches.map((match) => {
                      // BluePass cards resolve per-cabin-vs-charter the same way the text replies
                      // do (kai-conversation-flow-notes.md item 12) - prefer the per-cabin figure
                      // unless it's a bare "Quote on request". AU/Boattime cards carry priceLabel
                      // instead (null until a date is known - see the fallback prompt below).
                      const bluePassPrice =
                        match.pricePerCabin && match.pricePerCabin !== "Quote on request"
                          ? match.pricePerCabin
                          : (match.charterPrice ?? match.pricePerCabin ?? null);
                      const priceText = match.priceLabel ?? bluePassPrice;
                      const metaLine = [
                        match.tier,
                        match.region,
                        match.cabins ? `${match.cabins} cabins` : null,
                        match.maxGuests ? `up to ${match.maxGuests}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      /* No wrapping link any more. The card used to be one big <a>, which meant a
                         traveller could open the product page but had no way to *pick* it — and it
                         also nested a <div> inside a <span> when no productUrl existed, which is
                         invalid. Actions are now explicit siblings, so neither can ever trigger the
                         other: there is no ancestor click handler left to bubble into. */
                      return (
                        <span key={match.slug} className="kmatch">
                          <span className="kmatch__main">
                            {match.heroImageUrl ? (
                              // The catalog can point at assets this app doesn't carry (the yacht
                              // photos live in bluepass-app), so a miss hides the thumbnail rather
                              // than leaving a broken-image box in the card. Plain img, not
                              // next/image, because Kai Core may return absolute foreign URLs.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                className="kmatch__img"
                                src={match.heroImageUrl}
                                alt=""
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              /* No URL at all — the Rezdy-backed AU cards. The `onError` path above
                                 is left exactly as it was: a URL that 404s still hides itself,
                                 which is the BluePass side's own already-settled behaviour. */
                              <KaiMatchThumbPlaceholder />
                            )}
                            <span className="kmatch__body">
                              <span className="ds-body-sm kmatch__name">{match.name}</span>
                              {metaLine ? <span className="ds-micro kmatch__meta">{metaLine}</span> : null}
                              <span className="ds-micro kmatch__price">
                                {priceText ?? (match.dateChecked ? "Not available on this date" : "Share your date for pricing")}
                              </span>
                              {match.matchingReasons?.length ? (
                                <span className="ds-micro kmatch__why">
                                  {match.matchingReasons.slice(0, 2).join(" · ")}
                                </span>
                              ) : null}
                            </span>
                          </span>

                          <span className="kmatch__actions">
                            {/* Sends the product name down the same path as a typed message, which
                                is exactly what a traveller had to do by hand before. Kai then
                                continues on its own — asking for a date next if it does not have
                                one — so nothing about its flow needed changing, only this trigger.
                                Disabled while a reply is in flight for the same reason the composer
                                is: `send` early-returns on `thinking`, and a button that silently
                                does nothing is worse than one that looks unavailable. */}
                            <button
                              type="button"
                              className="kmatch__act kmatch__act--select"
                              onClick={() => void send(match.name)}
                              disabled={thinking}
                            >
                              Select this
                            </button>
                            {match.productUrl ? (
                              /* Read-only by design: opens the page and never touches the
                                 conversation. Absent entirely on the majority of cards, which carry
                                 no productUrl — better than a dead button that looks identical to
                                 the live one. */
                              <a
                                className="kmatch__act kmatch__act--view"
                                href={match.productUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View trip
                              </a>
                            ) : null}
                          </span>
                        </span>
                      );
                    })}
                  </span>
                ) : null}
              </span>
            </div>
          ))}

          {thinking ? (
            <div className="kmsg kmsg--assistant">
              <span className="kmsg__mark" aria-hidden>
                K
              </span>
              <span className="kmsg__bubble kmsg__bubble--typing" aria-label="Kai is typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : null}

          {dateOptions && dateOptions.length > 0 && !thinking ? (
            <KaiDateCalendar
              dates={dateOptions}
              disabled={thinking}
              onSelect={(date) => void send(date)}
            />
          ) : null}

          {timeOptions && timeOptions.length > 0 && !thinking ? (
            <div className="ktime-chips">
              {timeOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="kchip"
                  onClick={() => void send(option.label)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Ticket and extras selection share the same "pick option N, priced" shape - clicking
              sends "option N" (1-indexed), the exact phrasing Kai's own reply text already teaches
              ("You can say 'option 2'..."), so it parses the same way a typed reply would. */}
          {ticketOptions && ticketOptions.length > 0 && !thinking ? (
            <div className="koptions">
              {ticketOptions.map((option, index) => (
                <button
                  key={`${option.label}-${index}`}
                  type="button"
                  className="koption ds-body-sm"
                  onClick={() => void send(`option ${index + 1}`)}
                >
                  <span>{option.label}</span>
                  <span className="koption__price">${(option.unitPriceCents / 100).toFixed(2)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {extraOptions && extraOptions.length > 0 && !thinking ? (
            <div className="koptions">
              {extraOptions.map((option, index) => (
                <button
                  key={`${option.label}-${index}`}
                  type="button"
                  className="koption ds-body-sm"
                  onClick={() => void send(`option ${index + 1}`)}
                >
                  <span>{option.label}</span>
                  <span className="koption__price">${(option.unitPriceCents / 100).toFixed(2)}</span>
                </button>
              ))}
              <button
                type="button"
                className="koption koption--secondary ds-body-sm"
                onClick={() => void send("no extras")}
              >
                <span>No extras</span>
              </button>
            </div>
          ) : null}

          {contactRequest && !thinking ? (
            <form className="kform" onSubmit={submitContact}>
              <span className="ds-micro kform__lede">
                Kai needs these to send your enquiry to the operator.
              </span>
              <input
                className="kform__input ds-body-sm"
                value={contactForm.name}
                onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
                aria-label="Full name"
                autoComplete="name"
              />
              <input
                className="kform__input ds-body-sm"
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email"
                aria-label="Email"
                autoComplete="email"
              />
              <input
                className="kform__input ds-body-sm"
                value={contactForm.phone}
                onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="WhatsApp number"
                aria-label="WhatsApp number"
                autoComplete="tel"
              />
              {contactError ? <span className="ds-micro kform__err">{contactError}</span> : null}
              <button type="submit" className="kform__go ds-body-sm">
                Send to Kai
              </button>
            </form>
          ) : null}

          {paymentRequest && !thinking ? (
            <div className="kpay">
              <span className="ds-body-sm kpay__title">
                {paymentRequest.productTitle ?? "Your booking"}
              </span>
              {paymentRequest.dateText || paymentRequest.guests ? (
                <span className="ds-micro kpay__meta">
                  {[
                    paymentRequest.dateText,
                    paymentRequest.guests ? `${paymentRequest.guests} guests` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}

              {hostedCheckout ? (
                paymentRequest.checkoutUrl ? (
                  <button
                    type="button"
                    className="kpay__go ds-body-sm"
                    onClick={() => {
                      window.location.href = paymentRequest.checkoutUrl as string;
                    }}
                  >
                    Pay securely →
                  </button>
                ) : (
                  <span className="ds-micro kpay__note">
                    Kai is preparing your secure checkout link.
                  </span>
                )
              ) : (
                <>
                  {!paymentIntent ? (
                    <button
                      type="button"
                      className="kpay__go ds-body-sm"
                      onClick={() => void startPayment()}
                      disabled={paymentStatus === "starting"}
                    >
                      {paymentStatus === "starting" ? "Opening…" : "Pay by card"}
                    </button>
                  ) : (
                    <>
                      <input
                        className="kform__input ds-body-sm"
                        value={cardholder}
                        onChange={(e) => setCardholder(e.target.value)}
                        placeholder="Name on card"
                        aria-label="Name on card"
                        autoComplete="cc-name"
                      />
                      <div id="kai-card-element" className="kpay__card" />
                      <button
                        type="button"
                        className="kpay__go ds-body-sm"
                        onClick={() => void confirmPayment()}
                        disabled={paymentStatus !== "ready"}
                      >
                        {paymentStatus === "confirming" ? "Confirming…" : "Confirm payment"}
                      </button>
                    </>
                  )}
                </>
              )}

              {paymentError ? <span className="ds-micro kform__err">{paymentError}</span> : null}
            </div>
          ) : null}
        </div>

        {unfinishedOrder && !thinking ? (
          <div className="kpanel__chips">
            <button
              type="button"
              className="kchip"
              onClick={() => void continueUnfinishedOrder()}
              disabled={resumingOrder}
            >
              {resumingOrder ? "Pulling that up…" : "Continue my order"}
            </button>
            <button
              type="button"
              className="kchip"
              onClick={() => setUnfinishedOrder(null)}
              disabled={resumingOrder}
            >
              Start something new
            </button>
          </div>
        ) : questionInput && !thinking && !contactRequest ? (
          <div className="kpanel__chips kpanel__chips--control">
            <KaiQuestionControl key={`${messages.length}-${questionInput.kind}`} input={questionInput} disabled={thinking} onAnswer={(text) => void send(text)} />
          </div>
        ) : suggested.length && !thinking ? (
          <div className="kpanel__chips">
            {suggested.map((s) => (
              <button key={s.label} type="button" className="kchip" onClick={() => void send(s.message)}>
                {s.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="kpanel__compose">
          <textarea
            ref={inputRef}
            className="kpanel__input ds-body-sm"
            rows={1}
            value={draft}
            // kai-conversation-flow-notes.md finding #12: the greeting promises surf, sail
            // *and* dive, but this narrowed the ask to diving only. Also teaches the input
            // format by example, per the greeting rewrite's own placeholder proposal.
            placeholder='Try "Gold Coast, 2 people, Saturday"'
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            aria-label="Message Kai"
          />
          <button
            type="button"
            className="kpanel__send"
            onClick={() => void send(draft)}
            disabled={!draft.trim() || thinking}
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <span className="ds-micro kpanel__foot">
          Kai answers with real availability. Enter to send, Shift + Enter for a new line.
        </span>
      </div>
    </div>,
    document.body,
  );
}
