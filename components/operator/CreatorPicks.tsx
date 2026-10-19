"use client";

import { useState, useTransition } from "react";
import Notice from "@/components/auth/Notice";
import "@/app/creators.css";
import type { CreatorActionState } from "@/app/operator/creators/actions";
import type { CampaignView } from "@/lib/services/onboarding/creator-campaigns";

function money(cents: number, currency: string) {
  const symbol = currency === "AUD" ? "A$" : `${currency} `;
  return `${symbol}${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function shortDate(d: Date) {
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** Where each pick stands, in the operator's words rather than the system's. */
function standing(p: CampaignView) {
  switch (p.status) {
    case "REQUESTED":
      return p.creator.joined ? "Waiting for them to say yes" : p.creator.invited ? "Invited, waiting for them to join" : "Invitation on its way";
    case "ACCEPTED":
      return "Said yes. Their post is on its way.";
    case "FEATURED":
      return "Featured you";
    case "DISPUTED":
      return "We are looking into their post";
    case "DECLINED":
      return "Said no thanks. Their share is back with you.";
    case "CANCELLED":
      return "Taken back. Their share is back with you.";
  }
}

export default function CreatorPicks({ picks, actions }: {
  picks: CampaignView[];
  actions: { cancel: (id: string) => Promise<CreatorActionState>; report: (id: string) => Promise<CreatorActionState> };
}) {
  const [notice, setNotice] = useState<CreatorActionState>({ status: "idle" });
  const [pending, start] = useTransition();
  const run = (act: (id: string) => Promise<CreatorActionState>, id: string) => start(async () => setNotice(await act(id)));
  const shown = picks.filter((p) => p.status !== "CANCELLED");

  return (
    <div className="ob-picks">
      <ul className="ob-picks__list">
        {shown.map((p) => {
          const open = p.reviewEndsAt && new Date(p.reviewEndsAt) > new Date();
          return (
            <li key={p.id} className={`ob-pick ob-pick--${p.status.toLowerCase()}`}>
              <span className="ob-avatar" aria-hidden>{p.creator.name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("")}</span>
              <span className="ob-pick__body">
                <span className="ob-pick__name">{p.creator.name}</span>
                <span className="ob-pick__state">{standing(p)}</span>
                {p.status === "FEATURED" && p.postUrl ? (
                  <a href={p.postUrl} target="_blank" rel="noreferrer" className="ob-card__link">See their post ↗</a>
                ) : null}
              </span>
              <span className="ob-pick__side">
                <span className="ob-pick__credit">{p.status === "DECLINED" ? "Returned" : money(p.creditCents, p.currency)}</span>
                {p.status === "REQUESTED" ? (
                  <button type="button" className="ob-text-btn" disabled={pending} onClick={() => run(actions.cancel, p.id)}>Take back</button>
                ) : null}
                {p.status === "FEATURED" && open ? (
                  <button type="button" className="ob-text-btn" disabled={pending} onClick={() => run(actions.report, p.id)}>
                    Not featured? Tell us by {shortDate(p.reviewEndsAt!)}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {notice.status === "done" ? <Notice tone="success">{notice.message}</Notice> : null}
      {notice.status === "error" ? <Notice tone="error">{notice.message}</Notice> : null}
    </div>
  );
}
