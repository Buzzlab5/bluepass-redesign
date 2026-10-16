import { describe, expect, it } from "vitest";
import { isPreviewKey } from "@/lib/services/discover/preview-access";

const KEY = "a-long-enough-private-key-0123456789";

describe("isPreviewKey", () => {
  it("opens for the configured key", () => {
    expect(isPreviewKey(KEY, { DISCOVER_PREVIEW_KEY: KEY })).toBe(true);
  });

  it("stays shut for any other key", () => {
    expect(isPreviewKey("another-long-enough-private-key-1234", { DISCOVER_PREVIEW_KEY: KEY })).toBe(false);
    expect(isPreviewKey("", { DISCOVER_PREVIEW_KEY: KEY })).toBe(false);
  });

  it("stays shut when no key is configured, so the door only exists on purpose", () => {
    expect(isPreviewKey("anything", {})).toBe(false);
    expect(isPreviewKey("", { DISCOVER_PREVIEW_KEY: "" })).toBe(false);
  });

  it("refuses a key too short to be private", () => {
    expect(isPreviewKey("short", { DISCOVER_PREVIEW_KEY: "short" })).toBe(false);
  });
});
