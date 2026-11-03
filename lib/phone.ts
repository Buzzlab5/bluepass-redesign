import { DEFAULT_COUNTRY_ISO, findCountryByDial, findCountryByIso, type Country } from "@/lib/countries";

/**
 * Turning whatever someone types into E.164.
 *
 * Split out of `components/auth/PhoneField.tsx` because this is the part with
 * the edge cases — trunk prefixes, pasted international numbers, the length
 * ceiling — and `vitest.config.ts` only collects tests under `lib/`.
 */

/** E.164 caps the whole number — dial code included — at 15 digits. */
export const E164_MAX_DIGITS = 15;
/** Shortest real subscriber numbers (Niue, Tokelau) run to four digits. */
export const NATIONAL_MIN_DIGITS = 4;

export type ParsedPhone = {
  country: Country;
  /** National digits: no trunk prefix, no dial code, no separators. */
  national: string;
};

/**
 * Accepts what people actually paste.
 *
 * `+61412…` and `0061412…` carry their own country, so we adopt it rather than
 * stacking it on top of whatever is currently selected. A plain `0412…` is a
 * national number whose trunk prefix would corrupt the E.164 form, so the
 * leading zeros come off — that single rule is what stops the `08123456789`
 * shape that the free-text field used to let through.
 */
export function parsePhoneInput(raw: string, current: Country): ParsedPhone {
  const international = /^\s*(\+|00)/.test(raw);
  let digits = raw.replace(/\D/g, "");
  let country = current;

  if (international) {
    const withoutIddPrefix = digits.replace(/^00/, "");
    const detected = findCountryByDial(withoutIddPrefix);

    if (detected) {
      country = detected;
      digits = withoutIddPrefix.slice(detected.dial.length);
    }
  }

  return { country, national: clampNational(digits.replace(/^0+/, ""), country) };
}

/** Trims to whatever the dial code leaves within the E.164 budget. */
export function clampNational(digits: string, country: Country) {
  return digits.slice(0, E164_MAX_DIGITS - country.dial.length);
}

/** E.164, or `""` while the number is too short to be a real one. */
export function toE164(country: Country, national: string) {
  return national.length >= NATIONAL_MIN_DIGITS ? `+${country.dial}${national}` : "";
}

/**
 * Canonical E.164 for STORAGE ("+61412..."), or null when the input cannot be
 * a real number. Every write path for an operator phone must store this
 * marked form: the "+" marker is the provenance the webhook authorization
 * comparison relies on. Digit-stripping storage (normalizePhone-style)
 * destroys it - a bare national number whose leading digits form another
 * country's dial code would otherwise be ambiguous forever after.
 *
 * Input rules are explicit: "+"/"00" values carry their own country
 * (parsePhoneInput adopts it); a leading "0" marks a national number read
 * under `current` - the country the form collected - or the project default;
 * any OTHER bare digits are ambiguous (international-without-marker or
 * trunk-less national) and are REJECTED, never guessed. A value that cannot
 * produce a real, unambiguous E.164 returns null.
 */
export function toStorageE164(raw: string | null | undefined, current?: Country): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const fallback = current ?? findCountryByIso(DEFAULT_COUNTRY_ISO);
  if (!fallback) {
    return null;
  }
  if (!/^\s*(\+|00)/.test(raw)) {
    const digits = raw.replace(/\D/g, "");
    if (!digits.startsWith("0") && findCountryByDial(digits)) {
      /* Ambiguous: international digits that lost their marker, or a
         trunk-less national number. Storing either reading could silently
         point at the wrong subscriber (bare "61412..." mis-stored as
         +6161412... locks the real operator out), so the caller must get the
         number again in an explicit form - marked international, or national
         with its trunk "0" read under the collected/default country. */
      return null;
    }
  }
  const parsed = parsePhoneInput(raw, fallback);
  const e164 = toE164(parsed.country, parsed.national);
  return e164 === "" ? null : e164;
}
