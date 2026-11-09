"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Submit button that locks while its form is in flight, so a double click cannot start two checkouts. */
export default function QuoteButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="bk-cta" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
