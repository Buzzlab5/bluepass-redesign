import { describe, expect, it } from "vitest";
import { bankFormatFor, composeBankDetails } from "@/lib/bank-details";

describe("bankFormatFor", () => {
  it("reads a country code or name", () => {
    expect(bankFormatFor("AU")).toBe("AU");
    expect(bankFormatFor("australia")).toBe("AU");
    expect(bankFormatFor("ID")).toBe("ID");
    expect(bankFormatFor(" Indonesia ")).toBe("ID");
  });

  it("falls back to the international format", () => {
    expect(bankFormatFor("NZ")).toBe("INTL");
    expect(bankFormatFor("")).toBe("INTL");
    expect(bankFormatFor(null)).toBe("INTL");
  });
});

describe("composeBankDetails", () => {
  it("labels an Australian account and writes the BSB with its dash", () => {
    const result = composeBankDetails("AU", {
      accountName: "Dummy Marine Tours Pty Ltd",
      bsb: "062000",
      accountNumber: "1234 5678",
      bankName: "Commonwealth Bank",
    });

    expect(result).toEqual({
      ok: true,
      text: [
        "Account type: Australian account (BSB)",
        "Account name: Dummy Marine Tours Pty Ltd",
        "BSB: 062-000",
        "Account number: 12345678",
        "Bank: Commonwealth Bank",
      ].join("\n"),
    });
  });

  it("leaves out an optional field that was not filled in", () => {
    const result = composeBankDetails("AU", { accountName: "A", bsb: "062-000", accountNumber: "12345678" });
    expect(result.ok && result.text).not.toContain("Bank:");
  });

  it("names every field that is missing or wrong, not just the first", () => {
    const result = composeBankDetails("AU", { accountName: "", bsb: "12", accountNumber: "abc" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["accountName", "accountNumber", "bsb"]);
      expect(result.errors.bsb).toMatch(/six digits/);
    }
  });

  it("rejects an Australian account number of the wrong length", () => {
    expect(composeBankDetails("AU", { accountName: "A", bsb: "062000", accountNumber: "12345" }).ok).toBe(false);
    expect(composeBankDetails("AU", { accountName: "A", bsb: "062000", accountNumber: "12345678901" }).ok).toBe(false);
  });

  it("asks an Indonesian account for a bank and digits-only number", () => {
    expect(composeBankDetails("ID", { accountName: "PT Laut", bankName: "BCA", accountNumber: "1234567890" })).toMatchObject({ ok: true });
    expect(composeBankDetails("ID", { accountName: "PT Laut", bankName: "", accountNumber: "1234567890" }).ok).toBe(false);
    expect(composeBankDetails("ID", { accountName: "PT Laut", bankName: "BCA", accountNumber: "12ab" }).ok).toBe(false);
  });

  it("upper-cases and trims an international SWIFT and IBAN", () => {
    const result = composeBankDetails("INTL", {
      accountName: "Acme Ltd",
      bankName: "NatWest",
      accountNumber: "gb29 nwbk 6016 1331 9268 19",
      swift: "nwbkgb2l",
    });

    expect(result.ok && result.text).toContain("Account number or IBAN: GB29NWBK60161331926819");
    expect(result.ok && result.text).toContain("SWIFT / BIC: NWBKGB2L");
  });

  it("refuses a SWIFT code that is neither 8 nor 11 characters", () => {
    const result = composeBankDetails("INTL", { accountName: "A", bankName: "B", accountNumber: "GB29NWBK60161331926819", swift: "NWBK" });
    expect(result.ok).toBe(false);
  });
});
