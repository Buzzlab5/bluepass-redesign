"use client";

import { useEffect } from "react";
import { setKaiUnlocked } from "@/lib/kai-unlock";

/**
 * Switches the Kai chat on for as long as this component is on the page.
 *
 * The chat pill is off for the public (`KAI_ENABLED` in KaiChat.tsx). The private preview page
 * mounts this so the people reviewing it see the trips and the chat together, as the public will on
 * launch. It switches the chat on when it appears and off again when it goes, so clicking from the
 * preview to another page does not carry the pill along with it.
 */
export default function KaiUnlock() {
  useEffect(() => {
    setKaiUnlocked(true);
    return () => setKaiUnlocked(false);
  }, []);

  return null;
}
