"use client";

import type { ChannelQuestion } from "@/lib/services/channels/types";

/**
 * One of the operator's own booking questions, asked in their exact words and sent
 * back in the format their system checks: dates as yyyy-mm-dd, yes or no as true or
 * false, a list answer from the list.
 */
export default function ChannelQuestionField({
  question: q,
  value,
  onChange,
}: {
  question: ChannelQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  if (q.type === "boolean") {
    return (
      <label className="bk-check">
        <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
        <span className="ds-caption">{q.label}</span>
      </label>
    );
  }
  return (
    <label className="bk-field">
      <span className="ds-micro bk-label">{q.label}</span>
      {q.type === "list" ? (
        <select className="bk-select" value={value} required={q.required} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled={q.required}>{q.required ? "Choose one" : "None"}</option>
          {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={q.type === "date" ? "date" : q.type === "phone" ? "tel" : "text"}
          inputMode={q.type === "phone" ? "tel" : undefined}
          placeholder={q.type === "phone" ? "+61 412 345 678" : undefined}
          required={q.required}
          value={value}
          onChange={(e) => onChange(q.type === "phone" ? e.target.value.replace(/[^\d+]/g, "") : e.target.value)}
        />
      )}
    </label>
  );
}
