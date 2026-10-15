import { describe, expect, it } from "vitest";
import { z } from "zod";
import "@/lib/validation/zod-messages";

const message = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("friendly validation messages", () => {
  it("never says 'Invalid input'", () => {
    expect(message(z.number(), "abc")).toBe("Enter a number, like 120 or 95.50.");
    expect(message(z.number(), Number.NaN)).toBe("Enter a number, like 120 or 95.50.");
    expect(message(z.string(), undefined)).toBe("This is required.");
    expect(message(z.enum(["a", "b"]), "c")).toBe("Pick one of the options.");
    expect(message(z.string().email(), "nope")).toBe("That email address does not look right.");
  });

  it("describes a limit when the rule has no message of its own", () => {
    expect(message(z.number().min(1), 0)).toBe("Must be at least 1.");
    expect(message(z.number().max(10), 11)).toBe("Must be 10 or less.");
    expect(message(z.string().max(5), "toolong")).toBe("Keep this to 5 characters or fewer.");
    expect(message(z.string().min(3), "ab")).toBe("Use at least 3 characters.");
  });

  it("leaves a rule's own message alone", () => {
    expect(message(z.number().positive("A price has to be more than zero."), -1)).toBe("A price has to be more than zero.");
  });
});
