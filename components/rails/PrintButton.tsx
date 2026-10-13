"use client";

export default function PrintButton({ label = "Print manifest" }: { label?: string }) {
  return (
    <button type="button" className="rl-btn rl-btn--secondary rl-noprint" onClick={() => window.print()}>
      {label}
    </button>
  );
}
