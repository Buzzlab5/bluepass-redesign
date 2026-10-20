/**
 * Whether the Kai chat has been switched on for the page being shown.
 *
 * Held in the module, not only announced by an event: the page that switches Kai on (the private
 * preview) is rendered before the chat in the layout, so on a first load it runs first and an event
 * sent then would have nobody listening yet. The chat reads the current value when it mounts and
 * listens for changes after that.
 */
let unlocked = false;

export const KAI_UNLOCK_EVENT = "kai:unlock-change";

export function isKaiUnlocked() {
  return unlocked;
}

export function setKaiUnlocked(value: boolean) {
  unlocked = value;
  window.dispatchEvent(new Event(KAI_UNLOCK_EVENT));
}
