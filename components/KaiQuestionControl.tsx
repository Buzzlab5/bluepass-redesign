"use client";

import { useState } from "react";
import { guestsAnswerText, type KaiQuestionInput } from "@/lib/services/kai-core/question-input";

/**
 * Under a question from Kai, the control that answers it, so the traveller is never left guessing how to
 * phrase a reply and Kai is never left guessing what one meant. Pressing it sends an ordinary message in
 * wording Kai is certain to understand. The text box stays, for anyone who would rather type.
 */
export default function KaiQuestionControl({
  input,
  disabled,
  onAnswer,
}: {
  input: KaiQuestionInput;
  disabled: boolean;
  onAnswer: (text: string) => void;
}) {
  const [count, setCount] = useState(input.kind === "guests" ? input.initial : 0);

  if (input.kind === "guests") {
    return (
      <div className="kq" role="group" aria-label="How many of you are going?">
        <div className="kq__stepper">
          <button
            type="button"
            className="kq__step"
            aria-label="Fewer people"
            disabled={disabled || count <= input.min}
            onClick={() => setCount((c) => Math.max(input.min, c - 1))}
          >
            −
          </button>
          <output className="kq__count" aria-live="polite">
            {count}
          </output>
          <button
            type="button"
            className="kq__step"
            aria-label="More people"
            disabled={disabled || count >= input.max}
            onClick={() => setCount((c) => Math.min(input.max, c + 1))}
          >
            +
          </button>
        </div>
        <button type="button" className="kform__go ds-body-sm" disabled={disabled} onClick={() => onAnswer(guestsAnswerText(input, count))}>
          Send
        </button>
      </div>
    );
  }

  return (
    <div className={`kq kq--chips${input.kind === "month" ? " kq--months" : ""}`} role="group" aria-label="Choose one">
      {input.options.map((option) => (
        <button key={`${option.label}-${option.value}`} type="button" className="kchip" disabled={disabled} onClick={() => onAnswer(option.value)}>
          {option.label}
        </button>
      ))}
      {input.kind === "month" ? (
        <button type="button" className="kchip kchip--quiet" disabled={disabled} onClick={() => onAnswer(input.unsure.value)}>
          {input.unsure.label}
        </button>
      ) : null}
    </div>
  );
}
