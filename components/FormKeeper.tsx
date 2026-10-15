"use client";

import { useEffect } from "react";

/**
 * Makes every form say what went wrong and keep what the person typed.
 *
 * React 19 resets a form's plain inputs once its action finishes, success or not. For a refused
 * booking that meant the name and email vanished along with the refusal, and with the message sitting
 * below the fold the page looked like it had done nothing at all. Two rules fix that for every form
 * in the app at once, so no screen has to remember to:
 *
 * 1. A reset is cancelled while the form is showing an error. A form that succeeded still resets.
 * 2. When an error appears inside a form it is scrolled into view, because the message is usually
 *    far below the button that was pressed.
 *
 * What counts as "showing an error" is read from the page: the error notice, or any field marked
 * invalid. That keeps this independent of how each form is written.
 */
const ERROR = '.anotice--error, [role="alert"], [aria-invalid="true"], .adm-form__row--invalid';

export default function FormKeeper() {
  useEffect(() => {
    const onReset = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.querySelector(ERROR)) event.preventDefault();
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const notice = node.matches(".anotice--error") ? node : node.querySelector<HTMLElement>(".anotice--error");
          if (!notice || !notice.closest("form")) continue;
          // The notice grows in over half a second; wait so the centre it is scrolled to is its final one.
          window.setTimeout(() => notice.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
        }
      }
    });

    document.addEventListener("reset", onReset, true);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("reset", onReset, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
