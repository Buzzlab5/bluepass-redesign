"use client";

import { useEffect, useRef } from "react";
import Notice from "@/components/auth/Notice";
import type { RailsActionState } from "@/app/operator/rails-actions";

/** What a refused form leaves on the field that caused it. */
const MARK = "data-field-error";

function clearMarks(form: HTMLFormElement) {
  form.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute("aria-invalid"));
}

/**
 * The one line under a form saying what just happened, and, when the server named the field, the
 * field itself: outlined, with the reason beside it and the cursor already in it.
 *
 * Fields are found by `name`, or by `data-field` for a group (a row of departure buttons has no single
 * input to point at). Typing in the field clears the mark.
 */
export default function ActionNotice({ state }: { state: RailsActionState }) {
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    clearMarks(form);
    if (state.status !== "error" || !state.field) return;

    const target =
      form.querySelector<HTMLElement>(`[name="${CSS.escape(state.field)}"]:not([type="hidden"])`) ??
      form.querySelector<HTMLElement>(`[data-field="${CSS.escape(state.field)}"]`);
    if (!target) return;

    target.setAttribute("aria-invalid", "true");
    const message = document.createElement("span");
    message.setAttribute(MARK, "");
    message.className = "ds-micro field-error";
    message.textContent = state.message;
    (target.closest(".rl-field, .afield, .adm-form__row, fieldset") ?? target.parentElement)?.append(message);
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
      target.focus({ preventScroll: true });
    }

    const clear = () => clearMarks(form);
    target.addEventListener("input", clear, { once: true });
    target.addEventListener("click", clear, { once: true });
  }, [state]);

  return (
    <div ref={anchor} style={{ display: "contents" }}>
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "done" ? <Notice tone="success">{state.message}</Notice> : null}
    </div>
  );
}
