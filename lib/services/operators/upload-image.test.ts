import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareUpload } from "@/lib/services/operators/upload-image";

/** A photo-like test image: noise, so it is not one plain colour. */
async function photo(width: number, height: number, opts: { orientation?: number } = {}) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 2654435761) % 251;
  let image = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg();
  if (opts.orientation) image = image.withMetadata({ orientation: opts.orientation });
  return image.toBuffer();
}

async function logo(colour: { r: number; g: number; b: number }) {
  const mark = await sharp({ create: { width: 200, height: 80, channels: 4, background: { ...colour, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: 100, top: 40 }]).png().toBuffer();
}

describe("preparing an operator's upload", () => {
  it("turns a phone photo upright, cuts it to page size and drops its camera metadata", async () => {
    // A portrait photo stored sideways, as phones do, with the turn recorded in EXIF.
    const result = await prepareUpload(await photo(3200, 2400, { orientation: 6 }), "photo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.width, result.height]).toEqual([1800, 2400]);
    expect(result.contentType).toBe("image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("refuses a photo too small to look sharp, and a file that is not a photo", async () => {
    expect(await prepareUpload(await photo(400, 300), "photo")).toMatchObject({ ok: false, message: expect.stringContaining("too small") });
    expect(await prepareUpload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "photo")).toMatchObject({ ok: false });
    expect(await prepareUpload(Buffer.from("not an image at all"), "logo")).toMatchObject({ ok: false });
  });

  it("keeps a logo's clear background, and knows a white one needs a dark tile", async () => {
    const white = await prepareUpload(await logo({ r: 255, g: 255, b: 255 }), "logo");
    const navy = await prepareUpload(await logo({ r: 20, g: 30, b: 80 }), "logo");
    expect(white).toMatchObject({ ok: true, contentType: "image/png", light: true });
    expect(navy).toMatchObject({ ok: true, light: false });
    if (white.ok) expect((await sharp(white.bytes).metadata()).hasAlpha).toBe(true);
  });
});
