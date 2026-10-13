"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  COUNTRIES,
  DEFAULT_COUNTRY_ISO,
  findCountryByIso,
  type Country,
} from "@/lib/countries";
import { NATIONAL_MIN_DIGITS, clampNational, parsePhoneInput, toE164 } from "@/lib/phone";

/**
 * WhatsApp number field with a country picker.
 *
 * The register form used to take a single free-text phone number, which meant
 * the value reaching `registerTravellerSchema` could be anything — `08123456789`
 * (national, unusable for WhatsApp), `+61 234 567 876`, or a typo'd dial code.
 * Splitting the country out removes the whole class of mistakes: the dial code
 * is chosen, never typed, and the parent only ever receives E.164.
 *
 * The digits themselves are still not validated per-country — see the note in
 * `lib/countries.ts` for why we don't ship libphonenumber. What we do enforce is
 * the shape everything downstream depends on: leading `+`, digits only, and the
 * E.164 total-length ceiling. That normalisation lives in `lib/phone.ts`, where
 * it is covered by tests; this file is the interface around it.
 *
 * The starting country is always `DEFAULT_COUNTRY_ISO`, never the browser
 * locale: this is an Australian operator base, so AU is right far more often
 * than whatever region a traveller's laptop happens to be set to.
 */

export default function PhoneField({
  label,
  value,
  onChange,
  hint,
  required,
  disabled,
  confirmLabel = "Kai will message",
}: {
  label: string;
  /** E.164, e.g. `+61412345678`. Empty string while the number is incomplete. */
  value: string;
  onChange: (e164: string) => void;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  /** Words before the finished number in the line under the field. */
  confirmLabel?: string;
}) {
  const id = useId();
  const listId = useId();
  const [country, setCountry] = useState<Country>(
    () => findCountryByIso(DEFAULT_COUNTRY_ISO) ?? COUNTRIES[0],
  );
  const [national, setNational] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The last value we handed the parent — see the reset effect below. */
  const emitted = useRef("");

  const emit = (next: Country, digits: string) => {
    const e164 = toE164(next, digits);
    emitted.current = e164;
    onChange(e164);
  };

  const handleInput = (raw: string) => {
    const parsed = parsePhoneInput(raw, country);
    setCountry(parsed.country);
    setNational(parsed.national);
    emit(parsed.country, parsed.national);
  };

  const choose = (next: Country) => {
    // Trim if the new dial code is longer and pushes us past the E.164 ceiling.
    const digits = clampNational(national, next);
    setCountry(next);
    setNational(digits);
    emit(next, digits);
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  };

  /** Name, ISO code, or dial code — typing "62", "ID" or "indo" all work. */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso.toLowerCase().startsWith(q) ||
        c.dial.startsWith(q),
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /**
   * A cleared `value` means the parent reset the form, so drop the digits with
   * it. The country stays — it is a preference, not form data.
   *
   * The `emitted` guard matters: we also report "" whenever the number is too
   * short to be real, so backspacing from four digits to three sends the parent
   * an empty value. Without the comparison this effect would read that as a
   * reset and wipe the three digits still on screen.
   */
  useEffect(() => {
    if (value === emitted.current) return;
    if (!value) setNational("");
  }, [value]);

  return (
    <div className={`afield aphone${open ? " is-open" : ""}`} ref={rootRef}>
      <span className="afield__top">
        <label className="ds-micro afield__label" htmlFor={id}>
          {label}
        </label>
        {hint ? <span className="ds-micro afield__hint">{hint}</span> : null}
      </span>

      {/* Anchors the dropdown to the well itself, so the preview line below can
          change height without moving the panel. */}
      <div className="aphone__stack">
        <div className="afield__well aphone__well">
          <button
            type="button"
            className="aphone__country"
            onClick={() => setOpen((v) => !v)}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={`Country code: ${country.name}, +${country.dial}`}
          >
            <span className="aphone__flag" aria-hidden>
              {country.flag}
            </span>
            <span className="aphone__dial">+{country.dial}</span>
            <svg
              className={`aphone__chevron${open ? " is-open" : ""}`}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <span className="aphone__divider" aria-hidden />

          <input
            id={id}
            ref={inputRef}
            type="tel"
            inputMode="tel"
            className="afield__input aphone__input"
            value={national}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="400 000 000"
            autoComplete="tel-national"
            required={required}
            disabled={disabled}
            aria-describedby={`${id}-preview`}
          />
        </div>

        {open ? (
          <div className="aphone__panel">
            <input
              ref={searchRef}
              type="text"
              className="aphone__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code"
              aria-label="Search countries"
            />
            {/* Lenis owns the wheel events for the whole document, so a nested
                scroller has to opt out or the list just moves the page behind
                it — same treatment as the trip sheet and the Kai log. */}
            <ul className="aphone__list" id={listId} role="listbox" data-lenis-prevent>
              {results.map((c) => (
                <li key={c.iso}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.iso === country.iso}
                    className={`aphone__option${c.iso === country.iso ? " is-selected" : ""}`}
                    onClick={() => choose(c)}
                  >
                    <span className="aphone__flag" aria-hidden>
                      {c.flag}
                    </span>
                    <span className="aphone__name">{c.name}</span>
                    <span className="aphone__optdial">+{c.dial}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 ? (
                <li className="aphone__empty ds-body-sm">No country matches “{query}”.</li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      <span id={`${id}-preview`} className="ds-micro aphone__preview">
        {national.length >= NATIONAL_MIN_DIGITS
          ? `${confirmLabel} +${country.dial}${national}`
          : `${country.name}: enter your number without the leading 0`}
      </span>
    </div>
  );
}
