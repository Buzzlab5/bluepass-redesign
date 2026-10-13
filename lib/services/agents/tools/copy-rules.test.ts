import { describe, it, expect } from "vitest";
import { checkCopy, formatCopyCheck } from "./copy-rules";

function ruleIds(text: string, audience?: Parameters<typeof checkCopy>[1]) {
  const r = checkCopy(text, audience ?? {});
  return {
    pass: r.pass,
    blocked: r.blocking.map((v) => v.rule),
    warned: r.warnings.map((v) => v.rule),
  };
}

describe("checkCopy — the copy that is allowed", () => {
  it("passes the standard operator opener", () => {
    const r = checkCopy(
      "We already built your BluePass page. You set your own rates, we never mark you up, and 5% of every booking goes back to the ocean you work in. One click to claim.",
      { audience: "operator" },
    );
    expect(r.pass).toBe(true);
    expect(r.warnings).toHaveLength(0);
    expect(formatCopyCheck(r)).toBe("PASS. No copy-rule violations.");
  });

  it("allows typographic symbols and a five per cent written in words", () => {
    const r = checkCopy("Claim → activate → live. Five per cent of every booking funds the reef.", {
      audience: "operator",
    });
    expect(r.pass).toBe(true);
  });

  it("allows an internal document to state the commission band", () => {
    expect(ruleIds("Take rate is 18-20%, of which 5% is conservation.", { audience: "internal" })).toMatchObject({
      pass: true,
      blocked: [],
    });
  });
});

describe("checkCopy — the copy that is blocked", () => {
  it("blocks any percentage other than the conservation 5%", () => {
    const r = ruleIds("Operators keep 82% of every fare.", { audience: "operator" });
    expect(r.pass).toBe(false);
    expect(r.blocked).toContain("only-conservation-percentage");

    expect(ruleIds("We take eighteen per cent.", { audience: "customer" }).blocked).toContain(
      "only-conservation-percentage",
    );
    expect(ruleIds("A 10 percent deposit is due.", { audience: "customer" }).blocked).toContain(
      "only-conservation-percentage",
    );
  });

  it("blocks a price-match promise in every phrasing we have seen", () => {
    for (const line of [
      "We price-match any operator.",
      "We will beat any quote you find.",
      "Lowest price guaranteed.",
      "We guarantee the lowest rate online.",
    ]) {
      expect(ruleIds(line).blocked).toContain("no-price-match");
    }
  });

  it("blocks 'keep 100%' and its cousins", () => {
    for (const line of [
      "You keep 100% of every booking.",
      "Keep all of the fare, always.",
      "List free and keep everything.",
      "We take nothing from your bookings.",
    ]) {
      expect(ruleIds(line, { audience: "operator" }).blocked).toContain("no-keep-everything");
    }
  });

  it("blocks conservation stated as a share of commission or profit", () => {
    expect(ruleIds("We give 5% of our commission to the reef.", { audience: "customer" }).blocked).toContain(
      "conservation-is-of-the-booking",
    );
    expect(ruleIds("5% of profits go to conservation.", { audience: "customer" }).blocked).toContain(
      "conservation-is-of-the-booking",
    );
  });

  it("blocks emojis but not the approved typographic marks", () => {
    expect(ruleIds("Your page is live 🎉").blocked).toContain("no-emoji");
    expect(ruleIds("Dive in 🐠 with us").blocked).toContain("no-emoji");
    expect(ruleIds("Claim ✓ · activate → live").blocked).not.toContain("no-emoji");
  });

  it("blocks em dashes and a spaced en dash, but leaves a date range alone", () => {
    expect(ruleIds("Two boats — both on Rezdy.").blocked).toContain("no-em-dash");
    expect(ruleIds("Two boats – both on Rezdy.").blocked).toContain("no-em-dash");
    expect(ruleIds("Open June–October each year.").blocked).not.toContain("no-em-dash");
  });

  it("blocks Kai claiming to be human", () => {
    expect(ruleIds("Yes, I am human and I run the boat.", { audience: "customer" }).blocked).toContain(
      "no-human-impersonation",
    );
    expect(ruleIds("I'm not a bot, promise.", { audience: "customer" }).blocked).toContain(
      "no-human-impersonation",
    );
  });
});

describe("checkCopy — the copy that is flagged for a human", () => {
  it("warns on performance claims BluePass cannot yet evidence", () => {
    const r = checkCopy("Operators who join increase bookings in the first month.", { audience: "operator" });
    expect(r.pass).toBe(true);
    expect(r.warnings.map((v) => v.rule)).toContain("unsourced-performance-claim");
    expect(formatCopyCheck(r)).toMatch(/^PASS with warnings\./);
  });

  it("warns on unverified superlatives", () => {
    expect(ruleIds("Australia's leading marine marketplace.", { audience: "partner" }).warned).toContain(
      "unverified-superlative",
    );
  });

  it("reports every violation with its excerpt and position", () => {
    // "Keep 100%" trips two rules at once, which is the intended behaviour:
    // it is both a false promise and a percentage that is not the 5%.
    const r = checkCopy("Keep 100% and we price-match 🎉", { audience: "operator" });
    expect(r.pass).toBe(false);
    expect(r.blocking.map((v) => v.rule).sort()).toEqual([
      "no-emoji",
      "no-keep-everything",
      "no-price-match",
      "only-conservation-percentage",
    ]);
    for (const v of r.blocking) {
      expect(v.excerpt.length).toBeGreaterThan(0);
      expect(r.blocking.every((x) => x.index >= 0)).toBe(true);
    }
    expect(formatCopyCheck(r)).toMatch(/^BLOCKED\./);
  });
});
