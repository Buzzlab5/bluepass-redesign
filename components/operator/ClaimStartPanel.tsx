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
  | { kind: "sent" }
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
      setState({ kind: "sent" });
    } catch {
      setState({ kind: "error", message: "We could not reach Bluepass. Please try again shortly." });
    }
  }

  if (state.kind === "sent") {
    return (
      <div className="border-l-2 border-[var(--color-semantic-success)] pl-4">
        <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">
          Sent. Check {maskedEmail ? <strong>{maskedEmail}</strong> : "the business inbox"} for a
          link to finish claiming {businessName}. It is valid for seven days.
        </p>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          If it does not arrive, look in spam before asking for another one.
        </p>
      </div>
    );
  }

  if (state.kind === "no_email") {
    return (
      <div className="border-l-2 border-[var(--color-accent-blue)] pl-4">
        <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">
          We do not hold a business email for {businessName} yet, so there is nowhere safe to send
          the claim link.
        </p>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Write to{" "}
          <a className="underline underline-offset-4" href="mailto:hello@bluepass.co">
            hello@bluepass.co
          </a>{" "}
          from the business address and we will verify it by hand.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        className="bg-[var(--color-primary)] px-6 py-3 text-[15px] font-medium text-[var(--color-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-60"
        disabled={state.kind === "sending"}
        onClick={requestLink}
        type="button"
      >
        {state.kind === "sending" ? "Sending..." : "Send me the claim link"}
      </button>

      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        {maskedEmail ? (
          <>
            We will send it to <strong>{maskedEmail}</strong>, the address we already hold for this
            business. We do not send it anywhere else.
          </>
        ) : (
          <>We will send it to the business address we already hold. We do not send it anywhere else.</>
        )}
      </p>

      {state.kind === "error" && (
        <p className="mt-4 border-l-2 border-[var(--color-gradient-coral)] pl-4 text-sm text-[var(--color-ink)]">
          {state.message}
        </p>
      )}
    </div>
  );
}
