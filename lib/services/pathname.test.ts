import { describe, expect, it } from "vitest";
import { isClaimPathname, isConsolePathname } from "./pathname";

/**
 * Pure, so unlike most suites in this repo it needs no database row and no cleanup.
 *
 * What it is really protecting is a rendering decision made in two components at once: `Nav` and
 * `KaiChat` both stand aside for whatever this returns true for. A wrong answer either paints the
 * marketing nav over a console rail, or strips the nav off a public page — and neither shows up in
 * a type error.
 */
describe("isConsolePathname", () => {
  it("matches each console section root", () => {
    expect(isConsolePathname("/admin")).toBe(true);
    expect(isConsolePathname("/operator")).toBe(true);
    expect(isConsolePathname("/crm")).toBe(true);
  });

  it("matches pages nested under a console section", () => {
    expect(isConsolePathname("/admin/operators/new")).toBe(true);
    expect(isConsolePathname("/admin/payouts")).toBe(true);
    expect(isConsolePathname("/operator/listings")).toBe(true);
    expect(isConsolePathname("/crm/abc123")).toBe(true);
  });

  it("leaves marketing and auth routes alone", () => {
    for (const pathname of ["/", "/discover", "/login", "/register", "/conservation", "/partners"]) {
      expect(isConsolePathname(pathname)).toBe(false);
    }
  });

  /**
   * The reason this is a prefix list checked against a segment boundary rather than a bare
   * `startsWith`. No `/operators` route exists today, but the plural is the obvious name for the
   * public operator directory the services in `lib/services/operators/` are already written for —
   * and under `startsWith("/operator")` it would ship with no nav and no Kai launcher, looking like
   * a styling bug rather than this check quietly claiming it.
   */
  it("does not match a public route that merely shares the prefix", () => {
    expect(isConsolePathname("/operators")).toBe(false);
    expect(isConsolePathname("/operators/whitsunday-sailing")).toBe(false);
    expect(isConsolePathname("/administrators")).toBe(false);
  });
});

describe("isClaimPathname", () => {
  it("treats the operator claim pages as public, not console", () => {
    for (const pathname of ["/operator/claim/start/reef-co", "/operator/claim/verify"]) {
      expect(isClaimPathname(pathname)).toBe(true);
      expect(isConsolePathname(pathname)).toBe(false);
    }
  });

  it("leaves the rest of the operator console a console", () => {
    expect(isClaimPathname("/operator/claims")).toBe(false);
    expect(isConsolePathname("/operator/your-page")).toBe(true);
  });
});
