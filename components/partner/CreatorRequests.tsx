"use client";

import { useActionState, useState, useTransition } from "react";
import Notice from "@/components/auth/Notice";
import "@/app/creators.css";
import type { CreatorRequestState } from "@/app/partner-portal/actions";

const IDLE: CreatorRequestState = { status: "idle" };

export type CreatorRequest = {
  id: string;
  status: "REQUESTED" | "ACCEPTED" | "DECLINED" | "FEATURED" | "DISPUTED" | "CANCELLED";
  operatorName: string;
  operatorPath: string | null;
  creditCents: number;
  currency: string;
  postUrl: string | null;
  shareUrl: string | null;
};

function money(cents: number, currency: string) {
  return `${currency === "AUD" ? "A$" : `${currency} `}${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function PostForm({ id, action }: { id: string; action: (id: string, prev: CreatorRequestState, form: FormData) => Promise<CreatorRequestState> }) {
  const [state, formAction, pending] = useActionState(action.bind(null, id), IDLE);
  return (
    <form action={formAction} className="cr-post">
      <input name="postUrl" type="url" required placeholder="Link to your post" className="cr-input" aria-label="Link to your post" />
      <button type="submit" className="bpe__btn bpe__btn--primary cr-post__btn" disabled={pending}>{pending ? "Sending…" : "Share post"}</button>
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
    </form>
  );
}

/**
 * Operators who picked this creator to feature their trips, newest first: accept or decline,
 * then a tracked link to their page, then the post that features them.
 */
export default function CreatorRequests({ requests, actions }: {
  requests: CreatorRequest[];
  actions: {
    respond: (id: string, accept: boolean) => Promise<CreatorRequestState>;
    featured: (id: string, prev: CreatorRequestState, form: FormData) => Promise<CreatorRequestState>;
  };
}) {
  const [notice, setNotice] = useState<CreatorRequestState>(IDLE);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  if (!requests.length) return null;

  return (
    <section className="adm-block" aria-labelledby="cr-head">
      <header className="adm-block__head">
        <h2 id="cr-head" className="ds-headline adm-block__title">Operators who picked you</h2>
      </header>
      <p className="ds-body-sm" style={{ color: "var(--color-ink-muted)", margin: "0 0 12px" }}>
        They would like you to feature their trips. Their credit pays you once you post.
      </p>
      <ul className="ob-picks__list">
        {requests.map((r) => (
          <li key={r.id} className="ob-pick cr-request">
            <span className="ob-pick__body">
              <span className="ob-pick__name">{r.operatorName}</span>
              <span className="ob-pick__state">
                {r.status === "REQUESTED" ? "Would like you to feature their trips"
                  : r.status === "ACCEPTED" ? "Accepted. Share your post when it is up."
                  : r.status === "FEATURED" ? "Posted. Paid once their week to check it has passed."
                  : r.status === "DISPUTED" ? "They asked us to look at the post. We will be in touch."
                  : "Declined"}
              </span>
              {r.shareUrl && (r.status === "ACCEPTED" || r.status === "FEATURED") ? (
                <span className="cr-link">
                  <code>{r.shareUrl}</code>
                  <button type="button" className="ob-text-btn" onClick={() => { void navigator.clipboard?.writeText(r.shareUrl!); setCopied(r.id); }}>
                    {copied === r.id ? "Copied" : "Copy link"}
                  </button>
                </span>
              ) : null}
              {r.status === "ACCEPTED" ? <PostForm id={r.id} action={actions.featured} /> : null}
            </span>
            <span className="ob-pick__side">
              <span className="ob-pick__credit">{money(r.creditCents, r.currency)}</span>
              {r.status === "REQUESTED" ? (
                <span className="cr-answer">
                  <button type="button" className="bpe__btn bpe__btn--primary cr-answer__yes" disabled={pending} onClick={() => start(async () => setNotice(await actions.respond(r.id, true)))}>Accept</button>
                  <button type="button" className="ob-text-btn" disabled={pending} onClick={() => start(async () => setNotice(await actions.respond(r.id, false)))}>Decline</button>
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {notice.status === "done" ? <Notice tone="success">{notice.message}</Notice> : null}
      {notice.status === "error" ? <Notice tone="error">{notice.message}</Notice> : null}
    </section>
  );
}
