import { describe, expect, it } from "vitest";
import { inRegion, pageRegion } from "@/lib/services/operators/prepared-pages";

describe("which region a prepared page sits in", () => {
  it("reads Barbados from the country, and an Australian state however it is written", () => {
    expect(pageRegion({ country: "BB", state: "Barbados" })).toBe("barbados");
    expect(pageRegion({ country: null, state: "Barbados" })).toBe("barbados");
    expect(pageRegion({ state: "QLD" })).toBe("qld");
    expect(pageRegion({ state: "Western Australia" })).toBe("wa");
    expect(pageRegion({ state: null })).toBeNull();
  });

  it("takes in every state for Australia, and only the one asked for otherwise", () => {
    expect(inRegion("qld", "australia")).toBe(true);
    expect(inRegion("barbados", "australia")).toBe(false);
    expect(inRegion("qld", "wa")).toBe(false);
    expect(inRegion("barbados", "barbados")).toBe(true);
    expect(inRegion(null, null)).toBe(true);
  });
});
