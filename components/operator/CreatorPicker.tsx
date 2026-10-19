"use client";

import { useActionState, useState } from "react";
import Notice from "@/components/auth/Notice";
import "@/app/creators.css";
import type { CreatorActionState } from "@/app/operator/creators/actions";
import type { CreatorChoice } from "@/lib/services/onboarding/creator-campaigns";

const IDLE: CreatorActionState = { status: "idle" };

function initials(name: string) {
  return name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function websiteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The matched creators as cards to tap. Up to `slots` can be picked; the bar at the foot
 * says how many and sends them in one press.
 */
export default function CreatorPicker({ choices, slots, shareLabel, disabled, action }: {
  choices: CreatorChoice[];
  slots: number;
  shareLabel: string;
  disabled: boolean;
  action: (prev: CreatorActionState, form: FormData) => Promise<CreatorActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : prev.length < slots ? [...prev, id] : prev));
  const full = picked.length === slots;
  const chosen = picked.map((id) => choices.find((c) => c.id === id)).filter((c): c is CreatorChoice => Boolean(c));

  return (
    <form action={formAction} className="ob-picker">
      <ul className="ob-grid">
        {choices.map((c) => {
          const on = picked.includes(c.id);
          const locked = !on && full;
          const why = c.reasons.filter((r) => !r.startsWith("Based in"));
          return (
            <li key={c.id}>
              <label className={`ob-card${on ? " is-on" : ""}${locked ? " is-locked" : ""}`}>
                <input type="checkbox" name="creator" value={c.id} checked={on} disabled={disabled || locked} onChange={() => toggle(c.id)} />
                <span className="ob-card__top">
                  <span className="ob-avatar" aria-hidden>{initials(c.name)}</span>
                  <span className="ob-card__who">
                    <span className="ob-card__name">{c.name}</span>
                    <span className="ob-card__base">{[c.base, c.brand && c.brand !== c.name ? c.brand : null].filter(Boolean).join(" · ") || "Australia"}</span>
                  </span>
                  <span className="ob-tick" aria-hidden>{on ? "✓" : ""}</span>
                </span>
                {/* Where they live is already under their name. */}
                {why.length ? <span className="ob-card__why">{why.slice(0, 2).join(" · ")}</span> : null}
                {c.specialties.length ? (
                  <span className="ob-chips">{c.specialties.map((s) => <span key={s} className="ob-chip">{s}</span>)}</span>
                ) : null}
                <span className="ob-card__foot">
                  <span className={c.joined ? "ob-badge ob-badge--on" : "ob-badge"}>{c.joined ? "On Bluepass" : "We'll invite them"}</span>
                  {c.instagram ? (
                    <a href={`https://www.instagram.com/${c.instagram}/`} target="_blank" rel="noreferrer" className="ob-card__link" onClick={(e) => e.stopPropagation()}>@{c.instagram}</a>
                  ) : c.website ? (
                    <a href={c.website} target="_blank" rel="noreferrer" className="ob-card__link" onClick={(e) => e.stopPropagation()}>{websiteLabel(c.website)} ↗</a>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="ob-bar" role="region" aria-label="Your picks">
        <span className="ob-bar__picked">
          {chosen.length ? (
            <span className="ob-bar__faces" aria-hidden>{chosen.map((c) => <span key={c.id} className="ob-avatar ob-avatar--sm">{initials(c.name)}</span>)}</span>
          ) : null}
          <span>
            <strong>{picked.length} of {slots}</strong> picked
            <span className="ob-bar__sub">{shareLabel} of your credit each</span>
          </span>
        </span>
        <button type="submit" className="bk-cta ob-bar__send" disabled={disabled || pending || !full}>
          {pending ? "Sending…" : full ? (slots === 1 ? "Send to this creator" : `Send to these ${slots === 3 ? "three" : slots}`) : `Pick ${slots - picked.length} more`}
        </button>
      </div>
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </form>
  );
}
