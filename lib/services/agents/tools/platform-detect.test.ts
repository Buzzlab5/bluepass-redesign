import { describe, it, expect } from "vitest";
import { assessPlatform, detectPlatform, scoreProspect, toPmsPlatform } from "./platform-detect";

describe("detectPlatform", () => {
  it("finds Rezdy from any of its real embed signatures", () => {
    for (const html of [
      '<script src="https://rezdy.com/pluginJs"></script>',
      '<div data-rezdy="true"></div>',
      '<a href="https://book.rezdy.com/reviewOrder?pid=123">Book</a>',
      '<script src="/js/rezdywidget.js"></script>',
    ]) {
      const d = detectPlatform(html);
      expect(d.platform).toBe("Rezdy");
      expect(d.evidence).toBeTruthy();
    }
  });

  it("finds FareHarbor, ResPax and the generic ecommerce buckets", () => {
    expect(detectPlatform('<script src="//fareharbor.com/embeds/api/v1/"></script>').platform).toBe("FareHarbor");
    expect(detectPlatform('<a href="https://book.respax.com.au/x">Book</a>').platform).toBe("ResPax / Trilogy");
    expect(detectPlatform('<link href="https://cdn.shopify.com/s/x.css">').platform).toBe("Shopify");
    expect(detectPlatform('<body class="woocommerce-page">').platform).toBe("WooCommerce");
  });

  it("is case-insensitive, as the real pages are inconsistent", () => {
    expect(detectPlatform('<SCRIPT SRC="HTTPS://REZDY.COM/X.JS">').platform).toBe("Rezdy");
  });

  it("returns 'None detected' for an enquiry-only site", () => {
    const d = detectPlatform('<form action="/contact"><input name="email"></form><a href="tel:+61755551234">Call us</a>');
    expect(d.platform).toBe("None detected");
    expect(d.evidence).toBeNull();
    expect(d.all).toEqual([]);
  });

  it("prefers the tour-native system when a site carries two, and reports both", () => {
    const d = detectPlatform('<body class="woocommerce"><script src="https://rezdy.com/pluginJs"></script></body>');
    expect(d.platform).toBe("Rezdy");
    expect(d.all.map((a) => a.platform)).toEqual(["Rezdy", "WooCommerce"]);
  });
});

describe("assessPlatform", () => {
  it("puts Rezdy on the same-day path and FareHarbor behind an approval BluePass does not control", () => {
    expect(assessPlatform("Rezdy")).toMatchObject({ path: "connect_now", priority: 100 });
    expect(assessPlatform("FareHarbor").path).toBe("blocked");
    expect(assessPlatform("FareHarbor").note).toMatch(/approval/i);
  });

  it("routes an operator on nothing, and one on generic ecommerce, to Enquire", () => {
    expect(assessPlatform("None detected").path).toBe("enquire_only");
    expect(assessPlatform("WooCommerce").path).toBe("enquire_only");
  });

  it("treats Bokun as blocked because Viator would sit in the money path", () => {
    expect(assessPlatform("Bokun").path).toBe("blocked");
    expect(assessPlatform("Bokun").note).toMatch(/money path/i);
  });
});

describe("scoreProspect", () => {
  it("ranks a reachable Rezdy operator top", () => {
    const s = scoreProspect({ platform: "Rezdy", hasEmail: true, hasPhone: true });
    expect(s.priority).toBe(100);
    expect(s.path).toBe("connect_now");
  });

  it("lifts a warm introduction above a cold operator on the same system", () => {
    const cold = scoreProspect({ platform: "ResPax / Trilogy", hasEmail: true });
    const warm = scoreProspect({ platform: "ResPax / Trilogy", hasEmail: true, warmIntro: true });
    expect(warm.priority).toBeGreaterThan(cold.priority);
    expect(warm.reasons.join(" ")).toMatch(/warm introduction/i);
  });

  it("drops an unreachable operator down the queue however good their system is", () => {
    const s = scoreProspect({ platform: "Rezdy", hasEmail: false, hasPhone: false });
    expect(s.priority).toBeLessThan(50);
    expect(s.reasons.join(" ")).toMatch(/unreachable/i);
  });

  it("penalises a phone-only operator, because the first touch cannot be automated", () => {
    const s = scoreProspect({ platform: "Rezdy", hasEmail: false, hasPhone: true });
    expect(s.priority).toBe(90);
    expect(s.reasons.join(" ")).toMatch(/has to be a person/i);
  });

  it("never returns a score outside 0 to 100", () => {
    const high = scoreProspect({ platform: "Rezdy", hasEmail: true, warmIntro: true });
    expect(high.priority).toBe(100);
    expect(scoreProspect({ platform: "Ivvy", hasEmail: false, hasPhone: false }).priority).toBeGreaterThanOrEqual(0);
  });
});

describe("toPmsPlatform", () => {
  it("maps the systems BluePass can transact against onto the schema's four values", () => {
    expect(toPmsPlatform("Rezdy")).toBe("REZDY");
    expect(toPmsPlatform("Checkfront")).toBe("REZDY");
    expect(toPmsPlatform("FareHarbor")).toBe("FAREHARBOR");
    expect(toPmsPlatform("Bokun")).toBe("BOKUN");
  });

  it("records everything else as NATIVE, meaning BluePass carries the inventory", () => {
    for (const p of ["WooCommerce", "Zaui", "Shopify", "None detected"] as const) {
      expect(toPmsPlatform(p)).toBe("NATIVE");
    }
  });
});
