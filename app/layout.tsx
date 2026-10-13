import type { Metadata, Viewport } from "next";
import { Geist, Inter } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import Grain from "@/components/Grain";
import Nav from "@/components/Nav";
import KaiChat from "@/components/KaiChat";
import ReferralTracker from "@/components/ReferralTracker";
import FullPageNavigation from "@/components/FullPageNavigation";
import SessionProvider from "@/components/auth/SessionProvider";
import FlashNotice from "@/components/auth/FlashNotice";

/* The design system specifies GT Walsheim for display type and substitutes
 * Geist (see the DS readme's font caveat); Inter carries all body copy. */
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bluepass: Book the ocean. Leave it better.",
  description:
    "Vetted operators for surf, sail and dive, at the same price as booking direct. A fixed 5% of every fare protects reefs, funds ocean clean-ups and lifts coastal communities.",
  openGraph: {
    title: "Bluepass: Book the ocean. Leave it better.",
    description:
      "Vetted operators for surf, sail and dive, at the same price as booking direct.",
    type: "website",
  },
  /* The icons live in `public/`, not as `app/` file conventions, so that these
     declarations are the only ones emitted. The .ico holds 16, 32 and 48px
     entries; the convention advertises just the first one it reads, and a tab
     asking for 32 would upscale the 16 rather than use the entry already in the
     file. `sizes="any"` lets the browser pick from inside the .ico itself. */
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a09",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${inter.variable}`}>
      <body>
        {/* Chrome that persists across routes — only the page body swaps.
            The session wraps all of it: the nav and the Kai panel both need to
            know who is signed in, and one `/api/auth/me` serves both. */}
        <SmoothScroll />
        <Grain />
        <ReferralTracker />
        <FullPageNavigation />
        <SessionProvider>
          <Nav />
          <FlashNotice />
          {children}
          <KaiChat />
        </SessionProvider>
      </body>
    </html>
  );
}
