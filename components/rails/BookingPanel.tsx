"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PhoneField from "@/components/auth/PhoneField";
import ChannelQuestionField from "@/components/rails/ChannelQuestionField";
import { useStripeCard } from "@/components/rails/useStripeCard";
import { formatLocalTime } from "@/lib/services/rails/format";
import { formatMoney } from "@/lib/services/rails/money";
import { feeLabel, feesOnTop, type ChannelFee } from "@/lib/services/channels/fees";
import type { ChannelAnswers, ChannelExtra, ChannelQuestions } from "@/lib/services/channels/types";

type MonthDay = { date: string; status: "available" | "soldout" | "closed" | "none"; fromCents: number | null; seatsLeft: number };
type MonthData = { month: string; today: string; timezone: string; currency: string; days: MonthDay[] };
type Rate = {
  id: string;
  label: string;
  amountCents: number;
  currency: string;
  perGuest: boolean;
  minAge: number | null;
  maxAge: number | null;
  isDefault: boolean;
  /** Seats one of these takes ("Family of 4" is four). One when absent. */
  seatsUsed?: number;
};
type Departure = {
  departsAt: string;
  localTime: string;
  seatsLeft: number;
  minGuests: number;
  available: boolean;
  block: string | null;
  note: string | null;
  allDay?: boolean;
  /** Present when prices differ by departure, as Rezdy's do. */
  rates?: Rate[];
};
type DayData = {
  date: string;
  blackout: string | null;
  departures: Departure[];
  rates: Rate[];
  /** Taxes and fees the operator's booking system adds on top of the ticket prices. */
  fees?: ChannelFee[];
  /** Optional add-ons the operator sells with the trip. */
  extras?: ChannelExtra[];
};

export type PanelPayment = { kind: "checkout" } | { kind: "card"; publishableKey: string };

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_NAME = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_LABEL = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const SHORT_DAY = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const NO_QUESTIONS: ChannelQuestions = { booking: [], participant: [], pickups: [], pickupRequired: false, phoneRequired: false, notesRequired: false };

const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ageText(r: Rate) {
  if (r.minAge !== null && r.maxAge !== null) return `Ages ${r.minAge} to ${r.maxAge}`;
  if (r.minAge !== null) return `Ages ${r.minAge}+`;
  if (r.maxAge !== null) return `Under ${r.maxAge + 1}`;
  return null;
}

/** An add-on's description, cut to its first sentence so the card stays short. */
function brief(text: string | null) {
  if (!text) return null;
  const first = text.split(/(?<=[.!?])\s/)[0];
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}...` : first;
}

function timeText(d: Departure) {
  return d.allDay ? "All day" : formatLocalTime(d.localTime);
}

/**
 * The traveller's whole booking, in one card: day, time, who is coming, who they
 * are, pay. Every number on it is re-computed by the server before any money is
 * taken; this component only ever shows its working.
 *
 * The same component runs on the booking page and inside an operator's own website,
 * and for every system that holds seats. A trip on Bluepass's calendar, or a Rezdy
 * trip Bluepass takes payment for, ends at Stripe's payment page; Stripe will not run
 * inside a frame, so in the embed that last step is a link that opens it in the top
 * window. A Rezdy trip on automated payments ends with a card field instead: the card
 * is tokenised on Rezdy's Stripe account and Rezdy charges it as it books.
 */
export default function BookingPanel({
  slug,
  title,
  operatorName,
  embed = false,
  initial,
  fromCents,
  cutoffHours,
  questions = NO_QUESTIONS,
  payment = { kind: "checkout" },
}: {
  slug: string;
  /** Shown inside the card in the embed, where the operator's page supplies the rest. */
  title?: string;
  /** Named in the WhatsApp opt-in, which must say who the messages come from. */
  operatorName: string;
  embed?: boolean;
  initial: MonthData;
  fromCents: number | null;
  cutoffHours: number;
  /** The operator's own booking questions, for trips whose system requires them. */
  questions?: ChannelQuestions;
  payment?: PanelPayment;
}) {
  const [month, setMonth] = useState(initial.month);
  const [cal, setCal] = useState<MonthData>(initial);
  const [calLoading, setCalLoading] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [departsAt, setDepartsAt] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [addOns, setAddOns] = useState<Record<string, number>>({});
  const [groupSize, setGroupSize] = useState(2);
  const [step, setStep] = useState<"choose" | "details">("choose");
  const [lead, setLead] = useState({ name: "", email: "", phone: "", notes: "" });
  const [answers, setAnswers] = useState<ChannelAnswers>({ fields: {}, participants: [], pickup: null });
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotedCents, setQuotedCents] = useState<number | null>(null);
  const [held, setHeld] = useState<{ checkoutUrl: string; expiresAt: string; totalCents: number; currency: string } | null>(null);
  const [done, setDone] = useState<{ url: string; requested: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const currency = cal.currency;
  const card = useStripeCard(payment.kind === "card" && step === "details" ? payment.publishableKey : null);

  // Back from the payment page without paying: give the seats back now.
  useEffect(() => {
    const url = new URL(window.location.href);
    const release = url.searchParams.get("release");
    if (!release) return;
    fetch("/api/rails/release", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: release }) }).catch(() => {});
    url.searchParams.delete("release");
    window.history.replaceState(null, "", url.toString());
  }, []);

  // In an operator's site, tell the frame how tall to be so it never scrolls inside itself.
  // Measured from the widget's own frame, not the document: a document is never
  // shorter than the window it sits in, so it could grow the iframe but never shrink it.
  useEffect(() => {
    if (!embed || !root.current || window.parent === window) return;
    const frame = (root.current.closest(".bk-embed") as HTMLElement | null) ?? root.current;
    const post = () => window.parent.postMessage({ bluepassHeight: Math.ceil(frame.getBoundingClientRect().height) }, "*");
    const observer = new ResizeObserver(post);
    observer.observe(frame);
    post();
    return () => observer.disconnect();
  }, [embed]);

  // A new step replaces the card's contents; bring its top back into view rather than
  // leaving the traveller looking at the footer where the old, longer step ended.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (embed || !root.current) return;
    const top = root.current.getBoundingClientRect().top;
    if (top < 80) window.scrollBy({ top: top - 96, behavior: "smooth" });
  }, [step, held, done, embed]);

  useEffect(() => {
    if (month === cal.month) return;
    let live = true;
    setCalLoading(true);
    fetch(`/api/rails/${slug}/calendar?month=${month}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: MonthData) => live && setCal(data))
      .catch(() => live && setError("The calendar did not load. Check your connection and try again."))
      .finally(() => live && setCalLoading(false));
    return () => { live = false; };
  }, [month, cal.month, slug]);

  const pickDate = useCallback((d: string) => {
    setDate(d);
    setDepartsAt(null);
    setError(null);
    setQuotedCents(null);
    setDayLoading(true);
    fetch(`/api/rails/${slug}/departures?date=${d}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: DayData) => {
        setDay(data);
        const open = data.departures.filter((x) => x.available);
        if (open.length === 1) setDepartsAt(open[0].departsAt);
        const rates = open[0]?.rates ?? data.rates;
        setQty((cur) => {
          if (Object.values(cur).some((n) => n > 0) && rates.some((r) => (cur[r.id] ?? 0) > 0)) return cur;
          const def = rates.find((r) => r.perGuest && r.isDefault) ?? rates.find((r) => r.perGuest);
          const room = Math.max(...open.map((x) => x.seatsLeft), 0);
          return def ? { [def.id]: Math.max(1, Math.min(2, room)) } : {};
        });
      })
      .catch(() => setError("Those times did not load. Try the date again."))
      .finally(() => setDayLoading(false));
  }, [slug]);

  const departure = day?.departures.find((d) => d.departsAt === departsAt) ?? null;
  const rates = departure?.rates ?? day?.rates ?? [];
  const flatChosen = rates.some((r) => !r.perGuest && (qty[r.id] ?? 0) > 0);
  const perGuestSeats = rates.filter((r) => r.perGuest).reduce((n, r) => n + (qty[r.id] ?? 0) * (r.seatsUsed ?? 1), 0);
  const seats = flatChosen ? Math.max(groupSize, perGuestSeats) : perGuestSeats;
  const lines = rates.filter((r) => (qty[r.id] ?? 0) > 0).map((r) => ({ ...r, quantity: r.perGuest ? qty[r.id] : 1 }));
  const units = lines.reduce((n, l) => n + l.quantity, 0);
  const extraLines = (day?.extras ?? [])
    .map((e) => ({ ...e, quantity: e.kind === "perBooking" ? (addOns[e.name] ? 1 : 0) : e.kind === "perGuest" ? (addOns[e.name] ? units : 0) : addOns[e.name] ?? 0 }))
    .filter((e) => e.quantity > 0);
  const ticketsCents = lines.reduce((sum, l) => sum + l.amountCents * l.quantity, 0)
    + extraLines.reduce((sum, e) => sum + e.amountCents * e.quantity, 0);
  const feeCents = feesOnTop(day?.fees, ticketsCents, units);
  const linesCents = ticketsCents + feeCents;
  const totalCents = quotedCents ?? linesCents;
  const reefCents = Math.round(totalCents * 0.05);

  const problem = useMemo(() => {
    if (!departure || seats === 0) return null;
    if (seats > departure.seatsLeft) return `Only ${departure.seatsLeft} ${departure.seatsLeft === 1 ? "seat" : "seats"} left ${departure.allDay ? "that day" : `at ${formatLocalTime(departure.localTime)}`}.`;
    if (seats < departure.minGuests) return `This trip runs with ${departure.minGuests} or more.`;
    return null;
  }, [departure, seats]);

  const canContinue = Boolean(departure && seats > 0 && !problem && totalCents > 0);

  // The first guest's name questions answer themselves from the lead guest.
  useEffect(() => {
    if (step !== "details" || !questions.participant.length) return;
    setAnswers((cur) => {
      const participants = Array.from({ length: seats }, (_, i) => cur.participants[i] ?? {});
      const [first, ...rest] = lead.name.trim().split(/\s+/);
      const last = rest.length ? rest[rest.length - 1] : first;
      for (const q of questions.participant) {
        const key = q.label.trim().toLowerCase();
        if (participants[0][q.label]) continue;
        if (key === "first name" && first) participants[0] = { ...participants[0], [q.label]: rest.length ? [first, ...rest.slice(0, -1)].join(" ") : first };
        if (key === "last name" && last) participants[0] = { ...participants[0], [q.label]: last };
      }
      return { ...cur, participants };
    });
  }, [step, seats, questions.participant, lead.name]);

  const answersOk = useMemo(() => {
    const filled = (v: string | undefined) => Boolean(v && v.trim());
    if (questions.booking.some((q) => q.required && !filled(answers.fields[q.label]))) return false;
    for (let i = 0; i < seats; i += 1) {
      if (questions.participant.some((q) => q.required && !filled(answers.participants[i]?.[q.label]))) return false;
    }
    if (questions.pickupRequired && !answers.pickup) return false;
    return true;
  }, [questions, answers, seats]);

  const leadOk =
    lead.name.trim().length >= 2
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email.trim())
    && (!questions.phoneRequired || Boolean(lead.phone))
    && (!questions.notesRequired || lead.notes.trim().length > 0);
  const cardOk = payment.kind !== "card" || card.complete;

  async function reserve() {
    if (!departure || !leadOk || !answersOk || !cardOk) return;
    setBusy(true);
    setError(null);
    try {
      let cardToken: string | null = null;
      if (payment.kind === "card") {
        const tokenised = await card.tokenise(lead.name.trim());
        if (!tokenised.ok) {
          setError(tokenised.error);
          setBusy(false);
          return;
        }
        cardToken = tokenised.token;
      }
      const res = await fetch(`/api/rails/${slug}/reserve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          departsAt: departure.departsAt,
          quantities: Object.fromEntries(rates.map((r) => [r.id, r.perGuest ? qty[r.id] ?? 0 : (qty[r.id] ?? 0) > 0 ? 1 : 0])),
          ...(extraLines.length ? { extras: Object.fromEntries(extraLines.map((e) => [e.name, e.quantity])) } : {}),
          guests: flatChosen ? seats : undefined,
          lead: { name: lead.name.trim(), email: lead.email.trim(), phone: lead.phone.trim() || null },
          notes: lead.notes.trim() || null,
          whatsappOptIn: Boolean(lead.phone) && whatsappOptIn,
          returnTo: embed ? "embed" : "page",
          ...(questions.booking.length || questions.participant.length || questions.pickups.length
            ? { answers: { ...answers, participants: answers.participants.slice(0, seats) } }
            : {}),
          ...(cardToken ? { cardToken } : {}),
          expectedTotalCents: totalCents,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "PRICE_CHANGED" && typeof data.totalCents === "number") {
          setQuotedCents(data.totalCents);
          setError(`The total for this departure is ${formatMoney(data.totalCents, currency)}, including the operator's fees. Nothing was charged. Pay again to book at that price.`);
        } else {
          setError(data.error ?? "That did not go through. Please try again.");
          if (res.status === 409 && date && data.code === "UNAVAILABLE") pickDate(date);
        }
        setBusy(false);
        return;
      }
      if (data.confirmationUrl) {
        if (embed) {
          setDone({ url: data.confirmationUrl, requested: data.status === "REQUESTED" });
          setBusy(false);
        } else {
          window.location.assign(data.confirmationUrl);
        }
        return;
      }
      if (embed) {
        setHeld({ checkoutUrl: data.checkoutUrl, expiresAt: data.expiresAt, totalCents: data.totalCents, currency: data.currency });
        setBusy(false);
      } else {
        window.location.assign(data.checkoutUrl);
      }
    } catch {
      setError("We could not reach Bluepass. Check your connection and try again.");
      setBusy(false);
    }
  }

  const firstWeekday = (utc(`${cal.month}-01`).getUTCDay() + 6) % 7;
  const canGoBack = month > initial.month;
  const payLabel = busy ? (payment.kind === "card" ? "Booking…" : "Holding your seats…") : `Pay ${formatMoney(totalCents, currency)}`;

  return (
    <div ref={root} className={`bk-panel${embed ? " bk-panel--embed" : ""}`}>
      <header className="bk-panel__head">
        {embed && title ? <p className="ds-body bk-panel__title">{title}</p> : null}
        {fromCents !== null ? (
          <p className="bk-panel__price">
            <span className="ds-micro bk-muted">From</span>{" "}
            <span className="ds-headline">{formatMoney(fromCents, currency)}</span>{" "}
            <span className="ds-caption bk-muted">per guest</span>
          </p>
        ) : null}
      </header>

      {done ? (
        <div className="bk-held">
          <p className="ds-body bk-held__title">{done.requested ? `Your booking is with ${operatorName}.` : "You're booked."}</p>
          <p className="ds-caption bk-muted">
            {done.requested ? "They accept each booking themselves; you will hear the moment they do." : "Your confirmation is on its way to your inbox."}
          </p>
          <a href={done.url} target="_top" rel="noopener" className="bk-cta">See your booking</a>
        </div>
      ) : held ? (
        <div className="bk-held">
          <p className="ds-body bk-held__title">Your seats are held.</p>
          <p className="ds-caption bk-muted">
            Finish paying within 30 minutes and they are yours. Your confirmation comes straight to your inbox.
          </p>
          <a href={held.checkoutUrl} target="_top" rel="noopener" className="bk-cta">
            Pay {formatMoney(held.totalCents, held.currency)} securely
          </a>
        </div>
      ) : step === "choose" ? (
        <>
          <section className="bk-section" aria-label="Choose a date">
            <div className="bk-cal__head">
              <button type="button" className="bk-cal__nav" onClick={() => setMonth(shiftMonth(month, -1))} disabled={!canGoBack} aria-label="Previous month">‹</button>
              <span className="ds-body-sm bk-cal__month" aria-live="polite">{MONTH_NAME.format(utc(`${cal.month}-01`))}</span>
              <button type="button" className="bk-cal__nav" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
            </div>
            <div className={`bk-cal${calLoading ? " is-loading" : ""}`} role="group" aria-label="Dates">
              {WEEK.map((w, i) => <span key={i} className="ds-micro bk-cal__dow" aria-hidden>{w}</span>)}
              {Array.from({ length: firstWeekday }, (_, i) => <span key={`pad-${i}`} aria-hidden />)}
              {cal.days.map((d) => {
                const n = Number(d.date.slice(8));
                const selectable = d.status === "available";
                return (
                  <button
                    key={d.date}
                    type="button"
                    disabled={!selectable}
                    onClick={() => pickDate(d.date)}
                    className={`bk-cal__day is-${d.status}${date === d.date ? " is-selected" : ""}${d.date === cal.today ? " is-today" : ""}`}
                    aria-label={`${DAY_LABEL.format(utc(d.date))}${d.status === "soldout" ? ", sold out" : d.status === "available" ? ", available" : ", not running"}`}
                    aria-pressed={date === d.date}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            {!cal.days.some((d) => d.status === "available") && !calLoading ? (
              <p className="ds-caption bk-muted bk-center">Nothing free this month. Try the next one.</p>
            ) : null}
          </section>

          {date ? (
            <section className="bk-section" aria-label="Choose a time">
              <p className="ds-micro bk-label">{DAY_LABEL.format(utc(date))}</p>
              {dayLoading ? (
                <p className="ds-caption bk-muted">Checking seats…</p>
              ) : day && day.departures.length > 0 ? (
                <div className="bk-times">
                  {day.departures.map((d) => (
                    <button
                      key={d.departsAt}
                      type="button"
                      disabled={!d.available}
                      className={`bk-time${departsAt === d.departsAt ? " is-selected" : ""}`}
                      onClick={() => { setDepartsAt(d.departsAt); setQuotedCents(null); }}
                      aria-pressed={departsAt === d.departsAt}
                    >
                      <span className="ds-body">{timeText(d)}</span>
                      <span className="ds-micro">
                        {d.available ? (d.seatsLeft <= 5 ? `${d.seatsLeft} left` : "Available") : d.block === "full" ? "Full" : d.block === "cutoff" ? "Closed" : "Unavailable"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="ds-caption bk-muted">{day?.blackout ? `Not running: ${day.blackout}.` : "No departures that day."}</p>
              )}
            </section>
          ) : null}

          {date && day && rates.length > 0 ? (
            <section className="bk-section" aria-label="Who is coming">
              <p className="ds-micro bk-label">Who&rsquo;s coming</p>
              <div className="bk-steppers">
                {rates.map((r) =>
                  r.perGuest ? (
                    <div key={r.id} className="bk-stepper">
                      <span className="bk-stepper__label">
                        <span className="ds-body-sm">{r.label}</span>
                        <span className="ds-micro bk-muted">{[formatMoney(r.amountCents, r.currency), ageText(r)].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="bk-stepper__control">
                        <button type="button" onClick={() => { setQuotedCents(null); setQty((c) => ({ ...c, [r.id]: Math.max(0, (c[r.id] ?? 0) - 1) })); }} disabled={(qty[r.id] ?? 0) === 0} aria-label={`Fewer ${r.label}`}>−</button>
                        <output className="ds-body" aria-live="polite">{qty[r.id] ?? 0}</output>
                        <button type="button" onClick={() => { setQuotedCents(null); setQty((c) => ({ ...c, [r.id]: Math.min(50, (c[r.id] ?? 0) + 1) })); }} aria-label={`More ${r.label}`}>+</button>
                      </span>
                    </div>
                  ) : (
                    <label key={r.id} className={`bk-option${(qty[r.id] ?? 0) > 0 ? " is-on" : ""}`}>
                      <input type="checkbox" checked={(qty[r.id] ?? 0) > 0} onChange={(e) => { setQuotedCents(null); setQty((c) => ({ ...c, [r.id]: e.target.checked ? 1 : 0 })); }} />
                      <span className="bk-stepper__label">
                        <span className="ds-body-sm">{r.label}</span>
                        <span className="ds-micro bk-muted">{formatMoney(r.amountCents, r.currency)} for the group</span>
                      </span>
                    </label>
                  ),
                )}
                {flatChosen ? (
                  <div className="bk-stepper">
                    <span className="bk-stepper__label"><span className="ds-body-sm">People coming</span></span>
                    <span className="bk-stepper__control">
                      <button type="button" onClick={() => setGroupSize((g) => Math.max(1, g - 1))} disabled={groupSize <= 1} aria-label="Fewer people">−</button>
                      <output className="ds-body">{groupSize}</output>
                      <button type="button" onClick={() => setGroupSize((g) => Math.min(500, g + 1))} aria-label="More people">+</button>
                    </span>
                  </div>
                ) : null}
              </div>
              {problem ? <p className="ds-caption bk-warn" role="status">{problem}</p> : null}
            </section>
          ) : null}

          {date && day?.extras?.length && departure ? (
            <section className="bk-section" aria-label="Add-ons">
              <p className="ds-micro bk-label">Add-ons</p>
              <div className="bk-steppers">
                {day.extras.map((e) =>
                  e.kind === "any" ? (
                    <div key={e.name} className="bk-stepper">
                      <span className="bk-stepper__label">
                        <span className="ds-body-sm">{e.name}</span>
                        <span className="ds-micro bk-muted">{[formatMoney(e.amountCents, currency), brief(e.description)].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="bk-stepper__control">
                        <button type="button" onClick={() => { setQuotedCents(null); setAddOns((c) => ({ ...c, [e.name]: Math.max(0, (c[e.name] ?? 0) - 1) })); }} disabled={(addOns[e.name] ?? 0) === 0} aria-label={`Fewer ${e.name}`}>−</button>
                        <output className="ds-body" aria-live="polite">{addOns[e.name] ?? 0}</output>
                        <button type="button" onClick={() => { setQuotedCents(null); setAddOns((c) => ({ ...c, [e.name]: Math.min(50, (c[e.name] ?? 0) + 1) })); }} aria-label={`More ${e.name}`}>+</button>
                      </span>
                    </div>
                  ) : (
                    <label key={e.name} className={`bk-option${addOns[e.name] ? " is-on" : ""}`}>
                      <input type="checkbox" checked={Boolean(addOns[e.name])} onChange={(ev) => { setQuotedCents(null); setAddOns((c) => ({ ...c, [e.name]: ev.target.checked ? 1 : 0 })); }} />
                      <span className="bk-stepper__label">
                        <span className="ds-body-sm">{e.name}</span>
                        <span className="ds-micro bk-muted">
                          {e.kind === "perGuest" ? `${formatMoney(e.amountCents, currency)} each, for every guest` : `${formatMoney(e.amountCents, currency)} for the booking`}
                          {brief(e.description) ? ` · ${brief(e.description)}` : ""}
                        </span>
                      </span>
                    </label>
                  ),
                )}
              </div>
            </section>
          ) : null}

          {canContinue ? (
            <section className="bk-section bk-summary">
              {lines.map((l) => (
                <p key={l.id} className="bk-line ds-body-sm">
                  <span>{l.perGuest ? `${l.quantity} × ${l.label}` : l.label}</span>
                  <span>{formatMoney(l.amountCents * l.quantity, currency)}</span>
                </p>
              ))}
              {extraLines.map((e) => (
                <p key={e.name} className="bk-line ds-body-sm">
                  <span>{e.quantity > 1 ? `${e.quantity} × ${e.name}` : e.name}</span>
                  <span>{formatMoney(e.amountCents * e.quantity, currency)}</span>
                </p>
              ))}
              {totalCents > ticketsCents ? (
                <p className="bk-line ds-body-sm">
                  <span>{quotedCents !== null && quotedCents !== linesCents ? "Taxes and fees" : feeLabel(day?.fees)}</span>
                  <span>{formatMoney(totalCents - ticketsCents, currency)}</span>
                </p>
              ) : null}
              <p className="bk-line bk-line--total">
                <span className="ds-body">Total</span>
                <span className="ds-headline">{formatMoney(totalCents, currency)}</span>
              </p>
              <p className="ds-micro bk-reef">{formatMoney(reefCents, currency)} of this, a fixed 5%, protects the reef you visit.</p>
              <button type="button" className="bk-cta" onClick={() => { setStep("details"); setError(null); }}>Continue</button>
            </section>
          ) : null}
        </>
      ) : (
        <section className="bk-section" aria-label="Your details">
          <button type="button" className="ds-caption bk-back" onClick={() => setStep("choose")}>‹ {date ? SHORT_DAY.format(utc(date)) : ""}{departure ? `, ${timeText(departure)}` : ""} · {seats} {seats === 1 ? "guest" : "guests"}</button>
          <form
            className="bk-form"
            onSubmit={(e) => {
              e.preventDefault();
              void reserve();
            }}
          >
            <label className="bk-field">
              <span className="ds-micro bk-label">Full name</span>
              <input autoComplete="name" required value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} />
            </label>
            <label className="bk-field">
              <span className="ds-micro bk-label">Email</span>
              <input type="email" autoComplete="email" required value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
            </label>
            <PhoneField
              label="Mobile"
              hint={questions.phoneRequired ? `${operatorName} needs a number for this trip` : "So the crew can reach you on the day"}
              confirmLabel="The crew will have"
              required={questions.phoneRequired}
              value={lead.phone}
              onChange={(phone) => setLead((current) => ({ ...current, phone }))}
            />
            {lead.phone ? (
              <label className="bk-check">
                <input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} />
                <span className="ds-caption">
                  Send my booking, a reminder the day before and any changes to this number on WhatsApp, from {operatorName} and Bluepass.
                </span>
              </label>
            ) : null}

            {questions.pickups.length ? (
              <label className="bk-field">
                <span className="ds-micro bk-label">Pickup</span>
                <select
                  className="bk-select"
                  value={answers.pickup ?? ""}
                  required={questions.pickupRequired}
                  onChange={(e) => setAnswers((a) => ({ ...a, pickup: e.target.value || null }))}
                >
                  {questions.pickupRequired ? <option value="" disabled>Choose a pickup</option> : <option value="">I&rsquo;ll make my own way</option>}
                  {questions.pickups.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                {answers.pickup ? (
                  <span className="ds-micro bk-muted bk-field__hint">{questions.pickups.find((p) => p.name === answers.pickup)?.detail}</span>
                ) : null}
              </label>
            ) : null}

            {questions.booking.map((q) => (
              <ChannelQuestionField
                key={q.label}
                question={q}
                value={answers.fields[q.label] ?? ""}
                onChange={(v) => setAnswers((a) => ({ ...a, fields: { ...a.fields, [q.label]: v } }))}
              />
            ))}

            {questions.participant.length
              ? Array.from({ length: seats }, (_, i) => (
                  <fieldset key={i} className="bk-guest">
                    <legend className="ds-micro bk-label">{seats === 1 ? "The guest" : `Guest ${i + 1}`}</legend>
                    {questions.participant.map((q) => (
                      <ChannelQuestionField
                        key={q.label}
                        question={q}
                        value={answers.participants[i]?.[q.label] ?? ""}
                        onChange={(v) => setAnswers((a) => {
                          const participants = Array.from({ length: seats }, (_, j) => a.participants[j] ?? {});
                          participants[i] = { ...participants[i], [q.label]: v };
                          return { ...a, participants };
                        })}
                      />
                    ))}
                  </fieldset>
                ))
              : null}

            <label className="bk-field">
              <span className="ds-micro bk-label">Anything the crew should know</span>
              <input
                value={lead.notes}
                required={questions.notesRequired}
                onChange={(e) => setLead({ ...lead, notes: e.target.value })}
                placeholder={questions.notesRequired ? "Dietary needs, swimming ability, or \"nothing\"" : "Optional"}
              />
            </label>

            {payment.kind === "card" ? (
              <div className="bk-field">
                <span className="ds-micro bk-label">Card</span>
                <div ref={card.mount} className={`bk-card${card.focused ? " is-focused" : ""}`} />
                {card.error ? <span className="ds-micro bk-warn">{card.error}</span> : null}
              </div>
            ) : null}

            <button type="submit" className="bk-cta" disabled={!leadOk || !answersOk || !cardOk || busy}>
              {payLabel}
            </button>
          </form>
        </section>
      )}

      {error ? <p className="ds-caption bk-error" role="alert">{error}</p> : null}

      <footer className="bk-panel__foot ds-micro bk-muted">
        {payment.kind === "card"
          ? `Your card is charged by Rezdy, ${operatorName}'s booking system, the moment the booking is made. Bluepass never sees your card number.`
          : "Secure payment by Stripe. Bluepass holds it until your trip has run."}
        {cutoffHours > 0 ? ` Online booking closes ${cutoffHours} hours before departure.` : ""}
      </footer>
    </div>
  );
}
