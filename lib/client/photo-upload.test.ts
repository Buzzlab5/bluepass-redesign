import { describe, expect, it } from "vitest";
import { fitUnderLimit } from "@/lib/client/photo-upload";

/** A stand-in for a canvas encoder: bytes grow with pixels and with quality, like a real JPEG. */
const model = (bytesPerPixelAtFull: number) => async (width: number, height: number, quality: number) => ({
  size: Math.round(width * height * bytesPerPixelAtFull * quality * quality),
  width,
  height,
  quality,
});

describe("fitUnderLimit", () => {
  const limit = 500 * 1024;

  it("keeps full HD and the highest quality that fits", async () => {
    const result = await fitUnderLimit({ width: 4000, height: 3000 }, model(0.6), limit);
    expect(result).not.toBeNull();
    expect(Math.max(result!.width, result!.height)).toBe(1920);
    expect(result!.size).toBeLessThanOrEqual(limit);
    // The search should land close to the limit, not leave quality on the table.
    expect(result!.size).toBeGreaterThan(limit * 0.85);
  });

  it("shrinks the picture only when no acceptable quality fits at HD", async () => {
    const result = await fitUnderLimit({ width: 6000, height: 4000 }, model(1.45), limit);
    expect(result).not.toBeNull();
    expect(Math.max(result!.width, result!.height)).toBeLessThan(1920);
    expect(result!.size).toBeLessThanOrEqual(limit);
  });

  it("never makes a small picture larger", async () => {
    const result = await fitUnderLimit({ width: 1000, height: 600 }, model(0.9), limit);
    expect(result).not.toBeNull();
    expect(Math.max(result!.width, result!.height)).toBe(1000);
  });

  it("keeps the shape of the picture", async () => {
    const result = await fitUnderLimit({ width: 4000, height: 3000 }, model(0.6), limit);
    expect(result!.width / result!.height).toBeCloseTo(4 / 3, 2);
  });

  it("gives up honestly when nothing fits", async () => {
    expect(await fitUnderLimit({ width: 4000, height: 3000 }, model(50), limit)).toBeNull();
  });
});
