/**
 * Outbound dispatch, as a port.
 *
 * The agents draft and verify; something else sends. That something is
 * injected rather than imported, for two reasons. The honest one: this app
 * has no wired cold-email sender yet, and an agent that reported "sent"
 * into a void would be worse than one that reports "prepared". The design
 * one: the channel an operator is reachable on is an operational decision,
 * and swapping it should not touch an agent.
 *
 * Until a sender is wired, `dispatch` returns `prepared`, the draft is kept
 * on the lead's outreach log, and the agent says so rather than claiming a
 * send. Instagram and cold WhatsApp are deliberately not senders at all:
 * platform policy forbids automating them, so those drafts are always
 * prepared for a person.
 */

export type DispatchChannel = "email" | "whatsapp" | "instagram" | "sms";

export type DispatchRequest = {
  channel: DispatchChannel;
  to: string;
  subject?: string;
  body: string;
  /** Carried through to the provider for reply matching. */
  reference: string;
};

export type DispatchResult =
  | { status: "sent"; providerId: string | null }
  | { status: "prepared"; reason: string };

export type Dispatcher = (req: DispatchRequest) => Promise<DispatchResult>;

/** Channels an agent may never send on itself, whatever is wired. */
export const MANUAL_ONLY_CHANNELS: DispatchChannel[] = ["instagram", "whatsapp"];

let dispatcher: Dispatcher | null = null;

/** Wire once at startup. Pass null to go back to prepare-only. */
export function setDispatcher(fn: Dispatcher | null): void {
  dispatcher = fn;
}

export function dispatcherWired(): boolean {
  return dispatcher !== null;
}

export async function dispatch(req: DispatchRequest): Promise<DispatchResult> {
  if (MANUAL_ONLY_CHANNELS.includes(req.channel)) {
    return {
      status: "prepared",
      reason: `${req.channel} messages are never sent by an agent: the platform's own rules forbid automating cold outreach there, and an account ban would cost more than the send is worth. A person sends this one.`,
    };
  }
  if (!dispatcher) {
    return {
      status: "prepared",
      reason: "No sender is wired in this environment, so the draft is saved on the lead rather than sent.",
    };
  }
  return dispatcher(req);
}
