"use client";

import { useState } from "react";

type Props = {
  slug: string;
  businessName: string;
  /** Masked, e.g. "i...@example.com". Null when we hold no address. */
  maskedEmail: string | null;
};

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; devLink: string | null }
  | { kind: "no_email" }
  | { kind: "error"; message: string };

/**
 * The one action on the claim start page: ask Bluepass to send the claim link.
 *
 * The link always goes to the business address already on file, never to an
 * address typed into this page. That is the whole security model of the claim
 * funnel: anyone can open a claim page, because the slug is in an email we
 * sent, but only somebody who can read the business inbox can finish. So this
 * component deliberately has no email field.
 *
 * `POST /api/operator-claim-tokens` answers 202 with `missing_email` when there
 * is no address on file. That is a real and fairly common outcome on a BD list,
 * not an error, so it gets its own state and its own honest explanation rather
 * than a failure message that makes the operator think they did something wrong.
 */
export default function ClaimStartPanel({ slug, businessName, maskedEmail }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function requestLink() {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/operator-claim-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorSlug: slug }),
      });

      // 202 carries `ok: false` with a reason; it is a real answer, not a fault.
      if (res.status === 202) {
        setState({ kind: "no_email" });
        return;
      }
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : "We could not send the link right now. Please try again shortly.";
        setState({ kind: "error", message });
        return;
      }
      // Outside production the API hands the link back too, so the flow can be tried without email.
      const sent: unknown = await res.json().catch(() => null);
      const devLink = sent && typeof sent === "object" && "developmentClaimUrl" in sent && typeof sent.developmentClaimUrl === "string" ? sent.developmentClaimUrl : null;
      setState({ kind: "sent", devLink });
    } catch {
      setState({ kind: "error", message: "We could not reach Bluepass. Please try again shortly." });
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="opp-msg">
        <p>
          Sent. Check {maskedEmail ? <strong>{maskedEmail}</strong> : "the business inbox"} for a link to review and claim {businessName}. It works for seven days.
        </p>
        <p className="opp-sheet__small">If it doesn&rsquo;t arrive, look in spam before asking for another one.</p>
        {state.devLink ? <p className="opp-sheet__small">Development only: <a href={state.devLink}>open the claim link</a></p> : null}
      </div>
    );
  }

  if (state.kind === "no_email") {
    return (
      <div className="opp-msg">
        <p>We don&rsquo;t hold a business email for {businessName} yet, so there is nowhere safe to send the claim link.</p>
        <p className="opp-sheet__small">
          Write to <a href="mailto:hello@bluepass.co">hello@bluepass.co</a> from the business address and we will verify it.
        </p>
      </div>
    );
  }

  return (
    <>
      <button className="bk-cta" disabled={state.kind === "sending"} onClick={requestLink} type="button">
        {state.kind === "sending" ? "Sending…" : "Email me the claim link"}
      </button>
      <p className="opp-sheet__small">
        {maskedEmail ? (
          <>It goes to <strong>{maskedEmail}</strong>, the address we already hold for this business, and nowhere else.</>
        ) : (
          <>It goes to the business address we already hold, and nowhere else.</>
        )}
      </p>
      {state.kind === "error" ? <div className="opp-msg opp-msg--error"><p>{state.message}</p></div> : null}
    </>
  );
}
