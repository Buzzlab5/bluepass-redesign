"use client";

import { useId, useMemo, useState } from "react";
import {
  BANK_FORMATS,
  BANK_FORMAT_OPTIONS,
  bankFormatFor,
  composeBankDetails,
  type BankFormatId,
  type BankValues,
} from "@/lib/bank-details";

/**
 * Bank details, one box per thing the payer needs.
 *
 * The page still posts a single `bankDetails` value, so every action behind it is unchanged: this
 * component writes the labelled text into a hidden input, and only once every required field passes.
 * A half-filled form posts an empty value, which the actions read as "keep what is on file" — so the
 * boxes are marked required the moment any one of them is touched, and the browser refuses the save
 * before that can happen.
 *
 * `hasDetailsOnFile` makes the whole group optional while it is untouched, because the stored details
 * are write-only and cannot be shown back for editing. `optionalWhenEmpty` does the same for staff
 * onboarding an operator whose details have not arrived yet.
 */
export default function BankDetailsFields({
  country,
  hasDetailsOnFile = false,
  optionalWhenEmpty = false,
  disabled,
}: {
  /** The operator's country, used only to pick the starting format. */
  country?: string | null;
  hasDetailsOnFile?: boolean;
  /** For staff entering an operator who has not sent their details yet: leaving every box empty is allowed. */
  optionalWhenEmpty?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [formatId, setFormatId] = useState<BankFormatId>(() => bankFormatFor(country));
  const [values, setValues] = useState<BankValues>({});
  const format = BANK_FORMATS[formatId];

  const touched = format.fields.some((field) => (values[field.key] ?? "").trim() !== "");
  const mustFill = touched || (!hasDetailsOnFile && !optionalWhenEmpty);
  const composed = useMemo(() => composeBankDetails(formatId, values), [formatId, values]);

  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <div className="adm-bank">
      <input type="hidden" name="bankDetails" value={composed.ok && touched ? composed.text : ""} />

      <label className="afield adm-form__row adm-form__row--wide">
        <span className="afield__top">
          <span className="ds-micro afield__label">Account type</span>
          <span className="ds-micro afield__hint">Encrypted at rest</span>
        </span>
        <span className="afield__well">
          <select
            className="afield__input"
            value={formatId}
            disabled={disabled}
            onChange={(event) => {
              setFormatId(event.target.value as BankFormatId);
              setValues({});
            }}
          >
            {BANK_FORMAT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </label>

      <div className="adm-form__grid">
        {format.fields.map((field) => {
          const fieldId = `${id}-${formatId}-${field.key}`;
          const required = field.required && mustFill;

          return (
            <label key={fieldId} className="afield adm-form__row" htmlFor={fieldId}>
              <span className="afield__top">
                <span className="ds-micro afield__label">{field.label}</span>
                {!field.required ? <span className="ds-micro afield__hint">Optional</span> : null}
              </span>
              <span className="afield__well">
                <input
                  id={fieldId}
                  className="afield__input"
                  value={values[field.key] ?? ""}
                  onChange={(event) => {
                    set(field.key, event.target.value);
                    event.target.setCustomValidity("");
                  }}
                  onInvalid={(event) => {
                    const input = event.currentTarget;
                    input.setCustomValidity(input.validity.valueMissing ? `${field.label} is required.` : (field.patternHint ?? `${field.label} does not look right.`));
                  }}
                  placeholder={field.placeholder}
                  inputMode={field.inputMode}
                  maxLength={field.maxLength}
                  pattern={field.pattern}
                  title={field.patternHint}
                  required={required}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                />
              </span>
            </label>
          );
        })}
      </div>

      <span className="ds-micro adm-form__help">
        {hasDetailsOnFile
          ? "Bluepass already holds details for you. They are encrypted and can never be read back out, so these boxes start empty. Leave them all empty to keep what is on file; filling any one replaces everything."
          : optionalWhenEmpty
            ? "Leave these empty if the details are not to hand yet. Once any box is filled, the required ones must be too."
            : "Nothing is on file yet, so these are required. Copy each one from your bank app or statement."}
      </span>
    </div>
  );
}
