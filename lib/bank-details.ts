/**
 * Bank details, asked for one field at a time and stored as the same labelled text the admin console
 * already reveals.
 *
 * The stored value stays a single encrypted string (`{ bankDetails }`), because the person paying
 * reads it by eye and nothing parses it. What changes is how it is collected: a textarea invites
 * `062000 12345678` with the labels left off, and the payer then has to guess which number is the
 * BSB. Asking per field lets each one be checked (a BSB is six digits, an Australian account number
 * is six to ten) before the operator is told it is saved, and `composeBankDetails` writes the labels
 * back in so the person reading it never has to guess.
 */

export type BankFormatId = "AU" | "ID" | "INTL";

export type BankField = {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  maxLength: number;
  inputMode: "text" | "numeric";
  /** HTML `pattern`, matched against what the person typed, so the browser can refuse a bad value. */
  pattern?: string;
  /** What to tell them when the pattern fails. */
  patternHint?: string;
};

export type BankFormat = { id: BankFormatId; label: string; fields: BankField[] };

const ACCOUNT_NAME: BankField = {
  key: "accountName",
  label: "Account name",
  placeholder: "As it appears on your bank statement",
  required: true,
  maxLength: 120,
  inputMode: "text",
};

export const BANK_FORMATS: Record<BankFormatId, BankFormat> = {
  AU: {
    id: "AU",
    label: "Australian account (BSB)",
    fields: [
      ACCOUNT_NAME,
      {
        key: "bsb",
        label: "BSB",
        placeholder: "062-000",
        required: true,
        maxLength: 7,
        inputMode: "numeric",
        pattern: "\\d{3}-?\\d{3}",
        patternHint: "A BSB is six digits, like 062-000.",
      },
      {
        key: "accountNumber",
        label: "Account number",
        placeholder: "12345678",
        required: true,
        maxLength: 12,
        inputMode: "numeric",
        pattern: "[0-9 ]{6,12}",
        patternHint: "An Australian account number is six to ten digits.",
      },
      { key: "bankName", label: "Bank", placeholder: "Commonwealth Bank", required: false, maxLength: 80, inputMode: "text" },
    ],
  },
  ID: {
    id: "ID",
    label: "Indonesian account",
    fields: [
      ACCOUNT_NAME,
      { key: "bankName", label: "Bank", placeholder: "BCA, Mandiri, BNI, BRI…", required: true, maxLength: 80, inputMode: "text" },
      {
        key: "accountNumber",
        label: "Account number",
        placeholder: "1234567890",
        required: true,
        maxLength: 24,
        inputMode: "numeric",
        pattern: "[0-9 \\-]{5,24}",
        patternHint: "Digits only, between 5 and 20 of them.",
      },
      { key: "branch", label: "Branch or city", placeholder: "Optional", required: false, maxLength: 80, inputMode: "text" },
    ],
  },
  INTL: {
    id: "INTL",
    label: "International (SWIFT / IBAN)",
    fields: [
      ACCOUNT_NAME,
      { key: "bankName", label: "Bank", placeholder: "Bank name", required: true, maxLength: 80, inputMode: "text" },
      {
        key: "accountNumber",
        label: "Account number or IBAN",
        placeholder: "GB29 NWBK 6016 1331 9268 19",
        required: true,
        maxLength: 42,
        inputMode: "text",
        pattern: "[A-Za-z0-9 ]{5,42}",
        patternHint: "Letters and digits only. An IBAN may have spaces.",
      },
      {
        key: "swift",
        label: "SWIFT / BIC",
        placeholder: "NWBKGB2L",
        required: true,
        maxLength: 11,
        inputMode: "text",
        pattern: "[A-Za-z0-9]{8}([A-Za-z0-9]{3})?",
        patternHint: "A SWIFT code is 8 or 11 letters and digits.",
      },
      { key: "bankCountry", label: "Bank country", placeholder: "Optional", required: false, maxLength: 60, inputMode: "text" },
    ],
  },
};

const FORMAT_ORDER: BankFormatId[] = ["AU", "ID", "INTL"];
export const BANK_FORMAT_OPTIONS = FORMAT_ORDER.map((id) => ({ id, label: BANK_FORMATS[id].label }));

/** The format that fits the operator's country, so most people never touch the selector. */
export function bankFormatFor(country: string | null | undefined): BankFormatId {
  const c = (country ?? "").trim().toLowerCase();
  if (c === "au" || c === "australia") return "AU";
  if (c === "id" || c === "indonesia") return "ID";
  return "INTL";
}

export type BankValues = Record<string, string>;

function normalise(field: BankField, raw: string): string {
  const value = raw.trim().replace(/\s+/g, " ");
  switch (field.key) {
    case "bsb": {
      const digits = value.replace(/\D/g, "");
      return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : value;
    }
    case "accountNumber":
      return field.pattern?.startsWith("[A-Za-z") ? value.replace(/\s/g, "").toUpperCase() : value.replace(/[\s-]/g, "");
    case "swift":
      return value.replace(/\s/g, "").toUpperCase();
    default:
      return value;
  }
}

/** The first problem with these values, or null. Mirrors the HTML patterns so the rule lives in one file. */
export function bankFieldProblem(field: BankField, raw: string): string | null {
  const value = normalise(field, raw);
  if (!value) return field.required ? `${field.label} is required.` : null;
  if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(raw.trim())) return field.patternHint ?? `${field.label} does not look right.`;
  if (field.key === "bsb" && value.replace(/\D/g, "").length !== 6) return field.patternHint ?? "That BSB does not look right.";
  if (field.key === "accountNumber") {
    const digits = value.replace(/\D/g, "");
    if (field.pattern?.startsWith("[0-9 ]{6,12}") && (digits.length < 6 || digits.length > 10)) return field.patternHint ?? null;
    if (field.pattern?.startsWith("[0-9 \\-]") && (digits.length < 5 || digits.length > 20)) return field.patternHint ?? null;
  }
  return null;
}

export type ComposedBankDetails =
  | { ok: true; text: string }
  | { ok: false; errors: Record<string, string> };

/**
 * The labelled text that gets encrypted. Nothing is composed until every required field passes, so a
 * half-filled form can never be stored in place of the details already on file.
 */
export function composeBankDetails(formatId: BankFormatId, values: BankValues): ComposedBankDetails {
  const format = BANK_FORMATS[formatId];
  const errors: Record<string, string> = {};
  const lines: string[] = [`Account type: ${format.label}`];

  for (const field of format.fields) {
    const raw = values[field.key] ?? "";
    const problem = bankFieldProblem(field, raw);
    if (problem) {
      errors[field.key] = problem;
      continue;
    }
    const value = normalise(field, raw);
    if (value) lines.push(`${field.label}: ${value}`);
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, text: lines.join("\n") };
}
