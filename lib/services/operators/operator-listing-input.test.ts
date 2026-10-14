import { describe, expect, it } from "vitest";
import { operatorListingInputSchema } from "./operator-listing-service";

const valid = {
  title: "Testing Trip 2",
  category: "Sailing",
  region: "Brisbane",
  description: "A relaxed morning sail around the bay.",
  priceFrom: "75",
  maxGuests: "12",
};

function firstMessage(input: Record<string, unknown>) {
  const result = operatorListingInputSchema.safeParse(input);
  return result.success ? null : { message: result.error.issues[0].message, field: result.error.issues[0].path[0] };
}

describe("operatorListingInputSchema messages", () => {
  it("accepts a normal form, with prices typed the way operators type them", () => {
    for (const price of ["75", "75 aud", "A$75", "1,200", " 75.50 "]) {
      const result = operatorListingInputSchema.safeParse({ ...valid, priceFrom: price });
      expect(result.success, price).toBe(true);
    }
    expect(operatorListingInputSchema.parse({ ...valid, priceFrom: "1,200" }).priceFrom).toBe(1200);
    expect(operatorListingInputSchema.parse({ ...valid, priceFrom: "75 aud" }).priceFrom).toBe(75);
  });

  it("names the field and the fix, never just 'Invalid input'", () => {
    expect(firstMessage({ ...valid, description: "Testing" })).toEqual({
      message: expect.stringContaining("at least 10 characters"),
      field: "description",
    });
    expect(firstMessage({ ...valid, priceFrom: "abc" })).toEqual({
      message: "Price per guest must be a number, like 75.",
      field: "priceFrom",
    });
    expect(firstMessage({ ...valid, priceFrom: "0" })).toMatchObject({ field: "priceFrom", message: "Price per guest must be more than 0." });
    expect(firstMessage({ ...valid, maxGuests: "2.5" })).toMatchObject({ field: "maxGuests", message: "Max guests must be a whole number." });
    expect(firstMessage({ ...valid, title: "a" })).toMatchObject({ field: "title" });
    expect(firstMessage({ ...valid, region: "" })).toMatchObject({ field: "region", message: expect.stringContaining("where the trip runs") });
  });

  it("treats an empty optional field as not given", () => {
    const parsed = operatorListingInputSchema.parse({ ...valid, priceFrom: "", maxGuests: "" });
    expect(parsed.priceFrom).toBeUndefined();
    expect(parsed.maxGuests).toBeUndefined();
  });
});
