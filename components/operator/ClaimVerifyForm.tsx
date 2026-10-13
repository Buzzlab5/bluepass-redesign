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
      <div className="opp-msg">
        <p>Thank you. Your claim for {businessName} is with us.</p>
        <p className="opp-sheet__small">We check it within a working day. You aren&rsquo;t live yet, and we will write to you before anything is published.</p>
      </div>
    );
  }

  return (
    <form className="opp-form" onSubmit={submit}>
      <label className="opp-field">
        Your name
        <input name="claimantName" required maxLength={120} autoComplete="name" />
      </label>
      <label className="opp-field">
        Your email
        <input defaultValue={invitedEmail} maxLength={200} name="claimantEmail" required type="email" autoComplete="email" />
      </label>
      <div className="opp-form__pair">
        <label className="opp-field">
          <span>Your role <small>(optional)</small></span>
          <input maxLength={120} name="claimantRole" />
        </label>
        <label className="opp-field">
          <span>Phone <small>(optional)</small></span>
          <input maxLength={40} name="claimantPhone" autoComplete="tel" />
        </label>
      </div>
      <label className="opp-field">
        <span>Your website <small>(optional)</small></span>
        <input defaultValue={websiteUrl ?? ""} maxLength={300} name="websiteUrl" />
      </label>
      <label className="opp-field">
        <span>Anything we should know <small>(optional)</small></span>
        <textarea maxLength={1000} name="notes" rows={4} />
      </label>
      <label className="opp-check-row">
        <input name="authorized" type="checkbox" />
        <span>I am authorised to act for {businessName}.</span>
      </label>
      {state.kind === "error" ? <div className="opp-msg opp-msg--error"><p>{state.message}</p></div> : null}
      <button className="bk-cta" disabled={state.kind === "saving"} type="submit" style={{ alignSelf: "flex-start" }}>
        {state.kind === "saving" ? "Sending…" : "Submit claim"}
      </button>
    </form>
  );
}
