"use client";

import { useState } from "react";

/** A value an operator needs to paste somewhere else, with one button to copy it. */
export default function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rl-copy">
      <span className="ds-micro rl-copy__label">{label}</span>
      <div className="rl-copy__row">
        {multiline ? (
          <textarea className="rl-copy__value rl-copy__value--code" readOnly value={value} rows={3} onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input className="rl-copy__value" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        )}
        <button type="button" className="rl-btn rl-btn--secondary rl-btn--sm" onClick={copy} aria-live="polite">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
