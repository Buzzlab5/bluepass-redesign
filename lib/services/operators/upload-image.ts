import sharp from "sharp";

/**
 * A photo or logo an operator uploads to their own page, made fit to publish: checked to
 * be a real image, turned upright, cut down to a size a phone loads quickly, and
 * re-encoded, which also drops the camera's metadata (a phone photo carries where it was
 * taken). Only raster formats are accepted; an SVG can carry script.
 */

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "heif"]);
// The same floor the importer holds website photos to, so an upload never looks soft on a card.
const MIN = { width: 480, height: 320 };
const LONGEST = { photo: 2400, logo: 800 };

export type PreparedUpload =
  | { ok: true; bytes: Buffer; contentType: string; extension: string; width: number; height: number; light: boolean }
  | { ok: false; message: string };

export async function prepareUpload(input: Buffer, kind: "photo" | "logo"): Promise<PreparedUpload> {
  if (input.length > MAX_UPLOAD_BYTES) return { ok: false, message: "That file is over 12 MB. Try a smaller copy." };
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return { ok: false, message: "That file is not a photo we can read. Use a JPG, PNG or WebP." };
  }
  if (!meta.format || !FORMATS.has(meta.format) || !meta.width || !meta.height) {
    return { ok: false, message: "That file is not a photo we can read. Use a JPG, PNG or WebP." };
  }
  // EXIF orientations 5 to 8 swap width and height once the photo is turned upright.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  if (kind === "photo" && (Math.max(width, height) < MIN.width || Math.min(width, height) < MIN.height)) {
    return { ok: false, message: `That photo is ${width} by ${height} pixels, too small to look sharp. Use one at least ${MIN.width} by ${MIN.height}.` };
  }

  const image = sharp(input, { animated: false }).rotate().resize(LONGEST[kind], LONGEST[kind], { fit: "inside", withoutEnlargement: true });
  const out = kind === "logo"
    ? await image.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await image.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return {
    ok: true,
    bytes: out.data,
    contentType: kind === "logo" ? "image/png" : "image/jpeg",
    extension: kind === "logo" ? "png" : "jpg",
    width: out.info.width,
    height: out.info.height,
    light: kind === "logo" ? await isLightLogo(out.data) : false,
  };
}

/**
 * Whether a logo is light: white or pale marks on a transparent background, made for a
 * dark website header. Those go on a dark tile. A logo with its own solid background is
 * shown as it is.
 */
export async function isLightLogo(bytes: Buffer): Promise<boolean> {
  try {
    if (!(await sharp(bytes).metadata()).hasAlpha) return false;
    const { data, info } = await sharp(bytes).resize(96, 96, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let weight = 0;
    let light = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const alpha = data[i + 3] / 255;
      if (alpha < 0.15) continue;
      weight += alpha;
      light += alpha * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
    return weight > 0 && light / weight > 175;
  } catch {
    return false;
  }
}
