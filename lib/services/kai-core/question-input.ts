/**
 * The control that answers the question Kai just asked (a stepper for how many are going, months for
 * when, choices for diving or cruising). Kai decides which control, and the exact wording each one sends,
 * so what a press sends is always understood; this is only its shape on the way to the chat.
 * Mirrors Kai's src/core/bluepass/question-input.ts.
 */
export type KaiQuestionInput =
  | { kind: "guests"; min: number; max: number; initial: number; soloText: string; groupText: string }
  | { kind: "month"; options: { label: string; value: string }[]; unsure: { label: string; value: string } }
  | { kind: "choice"; options: { label: string; value: string }[] };

/** The message a stepper sends for a head count. */
export function guestsAnswerText(input: Extract<KaiQuestionInput, { kind: "guests" }>, count: number) {
  return count <= 1 ? input.soloText : input.groupText.replace("{n}", String(count));
}
