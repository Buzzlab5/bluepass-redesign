import type { ReactNode } from "react";
import "../rails.css";
import "../theme-light.css";

/** Operator pages share the booking pages' light styles: a traveller goes from one to the other. */
export default function OperatorsLayout({ children }: { children: ReactNode }) {
  return children;
}
