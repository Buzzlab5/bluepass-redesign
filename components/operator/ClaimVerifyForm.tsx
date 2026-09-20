"use client";

import { useState } from "react";

type Props = {
  slug: string;
  businessName: string;
  /** The address the claim link was sent to; prefilled and shown, but editable. */
  invitedEmail: string;
  websiteUrl: string | null;
};

type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const FIELD =
  "mt-2 w-full border border-[var(--color-hairline)] bg-transparent px-3 py-2 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent-blue)]";
const LABEL = "block text-sm font-medium text-[var(--color-ink)]";

/**
 * The claim itself, shown only after the emailed token has been verified server
 * side. Submitting creates a claim for review; it does not make the operator
 * live, and the copy says so, because an operator who thinks they are live and
 * is not will take their first real booking somewhere else.
 *
 * `authorized` is a required, unticked checkbox rather than implied consent.
 * The API rejects a claim without it, and this is somebody asserting they can
 * act for a business, which is worth an explicit action.
 */
export default function ClaimVerifyForm({
  slug,
  businessName,
  invitedEmail,
  websiteUrl,
}: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ kind: "saving" });

    const payload = {
      operatorSlug: slug,
      claimantName: String(form.get("claimantName") ?? "").trim(),
      claimantEmail: String(form.get("claimantEmail") ?? "").trim(),
      claimantPhone: String(form.get("claimantPhone") ?? "").trim() || undefined,
      claimantRole: String(form.get("claimantRole") ?? "").trim() || undefined,
      websiteUrl: String(form.get("websiteUrl") ?? "").trim() || undefined,
      notes: String(form.get("notes") ?? "").trim() || undefined,
      authorized: form.get("authorized") === "on",
    };

    if (!payload.authorized) {
      setState({
        kind: "error",
        message: "Please confirm you are authorised to act for this business.",
      });
      return;
    }

    try {
      const res = await fetch("/api/operator-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const message =
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "We could not save the claim. Please try again shortly.";
        setState({ kind: "error", message });
        return;
      }
      setState({ kind: "done" });
    } catch {
      setState({ kind: "error", message: "We could not reach Bluepass. Please try again shortly." });
    }
  }

  if (state.kind === "done") {
    return (
      <div className="border-l-2 border-[var(--color-semantic-success)] pl-4">
        <p className="text-[17px] leading-relaxed text-[var(--color-ink)]">
          Thank you. Your claim for {businessName} is with us.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          Somebody checks it by hand, usually within a working day. You are not live yet, and we
          will write to you before anything is published.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div>
        <label className={LABEL} htmlFor="claimantName">
          Your name
        </label>
        <input className={FIELD} id="claimantName" name="claimantName" required maxLength={120} />
      </div>

      <div>
        <label className={LABEL} htmlFor="claimantEmail">
          Your email
        </label>
        <input
          className={FIELD}
          defaultValue={invitedEmail}
          id="claimantEmail"
          maxLength={200}
          name="claimantEmail"
          required
          type="email"
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="claimantRole">
            Your role <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
          </label>
          <input className={FIELD} id="claimantRole" maxLength={120} name="claimantRole" />
        </div>
        <div>
          <label className={LABEL} htmlFor="claimantPhone">
            Phone <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
          </label>
          <input className={FIELD} id="claimantPhone" maxLength={40} name="claimantPhone" />
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="websiteUrl">
          Your website <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
        </label>
        <input
          className={FIELD}
          defaultValue={websiteUrl ?? ""}
          id="websiteUrl"
          maxLength={300}
          name="websiteUrl"
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="notes">
          Anything we should know{" "}
          <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
        </label>
        <textarea className={FIELD} id="notes" maxLength={1000} name="notes" rows={4} />
      </div>

      <label className="flex items-start gap-3 text-[15px] leading-relaxed text-[var(--color-ink)]">
        <input className="mt-1" name="authorized" type="checkbox" />
        <span>I am authorised to act for {businessName}.</span>
      </label>

      {state.kind === "error" && (
        <p className="border-l-2 border-[var(--color-gradient-coral)] pl-4 text-sm text-[var(--color-ink)]">
          {state.message}
        </p>
      )}

      <button
        className="bg-[var(--color-primary)] px-6 py-3 text-[15px] font-medium text-[var(--color-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-60"
        disabled={state.kind === "saving"}
        type="submit"
      >
        {state.kind === "saving" ? "Sending..." : "Submit claim"}
      </button>
    </form>
  );
}
