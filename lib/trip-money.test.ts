import { describe, expect, it } from "vitest";
import { tripMoney } from "@/lib/discover";

describe("tripMoney", () => {
  it("keeps the A$ look for Australian dollars, and for trips with no currency", () => {
    expect(tripMoney(2190, "AUD")).toBe("A$2,190");
    expect(tripMoney(2190)).toBe("A$2,190");
  });

  it("names other currencies so US dollars are never read as Australian dollars", () => {
    expect(tripMoney(95, "USD")).toBe("US$95");
    expect(tripMoney(1500000, "IDR")).toBe("Rp 1,500,000");
    expect(tripMoney(80, "EUR")).toBe("€80");
    expect(tripMoney(10, "bbd")).toBe("BBD 10");
  });
});
