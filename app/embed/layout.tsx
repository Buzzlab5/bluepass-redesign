import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../rails.css";
import "../theme-light.css";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The widget an operator puts on their own website. Chrome-free; see isEmbedPathname. */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <main className="bk-embed theme-light">{children}</main>;
}
