"use client";

import { useActionState } from "react";
import Notice from "@/components/auth/Notice";
import "@/app/creators.css";
import type { VisitActionState } from "@/app/admin/visits/actions";

const IDLE: VisitActionState = { status: "idle" };

/** The business email the operator gives in person, typed by the visitor. */
export default function ConfirmEmailForm({ slug, current, action }: {
  slug: string;
  current: string | null;
  action: (slug: string, prev: VisitActionState, form: FormData) => Promise<VisitActionState>;
}) {
  const [state, formAction, pending] = useActionState(action.bind(null, slug), IDLE);
  return (
    <form action={formAction} className="vi-email">
      <label className="ds-micro vi-email__label" htmlFor="vi-email">{current ? "A different business email" : "Their business email"}</label>
      <div className="vi-email__row">
        <input id="vi-email" name="email" type="email" required inputMode="email" autoComplete="off" placeholder="name@their-business.com" className="cr-input" />
        <button type="submit" className="bpe__btn bpe__btn--primary ca-btn" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
    </form>
  );
}
