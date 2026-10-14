"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchMe, logout as postLogout, type Traveller } from "@/lib/auth-client";

type Ctx = {
  traveller: Traveller | null;
  /** True until the first `/api/auth/me` settles — the nav shows a rest state, not a wrong one. */
  loading: boolean;
  /** Whether the previous page in this tab was signed in. Only for placeholders while `loading`. */
  signedInHint: boolean;
  /**
   * Returns what it just fetched as well as storing it. A caller that needs to act on the fresh
   * session immediately — the login page deciding where to land an operator — cannot read it off
   * the context, which is still holding the previous render's value at that point.
   */
  refresh: () => Promise<Traveller | null>;
  signOut: () => Promise<void>;
};

/* Layout effects only run in the browser; on the server this is a no-op, which keeps the first
   render identical on both sides. */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* A yes/no left by the last page in this tab: was somebody signed in? It is never read to decide
   what a visitor may do, only to shape the nav's placeholder while `/api/auth/me` is on its way, so
   that a signed-in visitor does not see a "Join Bluepass" button flash at them on every page. */
const HINT_KEY = "bp-signed-in-hint";
const readHint = () => {
  try {
    return window.sessionStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
};
const writeHint = (signedIn: boolean) => {
  try {
    window.sessionStorage.setItem(HINT_KEY, signedIn ? "1" : "0");
  } catch {
    // Storage blocked: the placeholder just falls back to the signed-out shape.
  }
};

const SessionCtx = createContext<Ctx | null>(null);

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/**
 * Holds the signed-in traveller for the whole app.
 *
 * `/api/auth/me` is called once on mount rather than per-component: the session
 * cookie is httpOnly, so the client has no way to know whether it is signed in
 * without asking the server, and the nav plus every auth page would otherwise
 * each fire their own request.
 */
export default function SessionProvider({ children }: { children: ReactNode }) {
  const [traveller, setTraveller] = useState<Traveller | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedInHint, setSignedInHint] = useState(false);

  useBrowserLayoutEffect(() => {
    setSignedInHint(readHint());
  }, []);

  const refresh = useCallback(async () => {
    const next = await fetchMe();
    writeHint(Boolean(next));
    setSignedInHint(Boolean(next));
    setTraveller(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await postLogout();
    writeHint(false);
    setSignedInHint(false);
    setTraveller(null);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ traveller, loading, signedInHint, refresh, signOut }),
    [traveller, loading, signedInHint, refresh, signOut],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
