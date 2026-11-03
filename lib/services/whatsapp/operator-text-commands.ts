/**
 * Free-text operator commands. The dispatch message already tells operators to
 * "Reply accept:<id>, decline:<id>, or counter:<id>" - this is the parser for
 * those replies, plus the bare forms ("accept") that resolve against the
 * sender's pending inquiries.
 *
 * Pure and DB-free so the command grammar is unit-testable on its own.
 */

export type OperatorTextCommandAction = "accept" | "decline" | "counter";

export type OperatorTextCommand = {
  action: OperatorTextCommandAction;
  /** The inquiry reference after the colon, when given (full id or id suffix). */
  ref: string | null;
  /** Counter terms in plain text; only meaningful for action "counter". */
  terms: string | null;
};

const commandPattern =
  /^(accept|decline|counter|counter-offer)(?::([^\s]+))?(?:\s+([\s\S]+))?$/i;

export function parseOperatorTextCommand(body: string): OperatorTextCommand | null {
  const match = body.trim().match(commandPattern);
  if (!match) {
    return null;
  }

  const action: OperatorTextCommandAction = match[1].toLowerCase().startsWith("counter")
    ? "counter"
    : (match[1].toLowerCase() as OperatorTextCommandAction);

  return {
    action,
    ref: match[2]?.trim() ? match[2].trim() : null,
    terms: match[3]?.trim() ? match[3].trim() : null,
  };
}

/** The short reference shown to operators in ambiguity lists: the id tail, unique per listing. */
export function shortInquiryRef(inquiryId: string): string {
  return inquiryId.slice(-6);
}
