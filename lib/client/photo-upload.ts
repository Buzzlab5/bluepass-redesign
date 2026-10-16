/** The most a photo may weigh once it leaves the browser. */
export const MAX_UPLOAD_BYTES = 500 * 1024;
/** Long side of an HD picture. A photo is never shrunk below the smallest size here unless it was smaller to begin with. */
const SIZES = [1920, 1600, 1280];
/** Quality is lowered only this far before the picture itself is made smaller: below it, artefacts show. */
const MIN_QUALITY = 0.55;
const MAX_QUALITY = 0.92;

export type Encoded = { size: number };
export type Encoder<T extends Encoded> = (width: number, height: number, quality: number) => Promise<T | null>;

/**
 * Finds the best picture that fits the size limit: full HD at the highest quality that fits, and only
 * if no quality is good enough at that size, the next size down. Returns null if nothing fits.
 *
 * The search is pure (the encoder is passed in) so the rule can be tested without a canvas.
 */
export async function fitUnderLimit<T extends Encoded>(
  source: { width: number; height: number },
  encode: Encoder<T>,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<T | null> {
  const longSide = Math.max(source.width, source.height);
  const sizes = [...new Set(SIZES.map((s) => Math.min(s, longSide)))];

  for (const side of sizes) {
    const scale = side / longSide;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const lowest = await encode(width, height, MIN_QUALITY);
    if (!lowest || lowest.size > maxBytes) continue;

    // The lowest quality fits, so the answer is somewhere between it and the best quality: keep the highest that fits.
    let best = lowest;
    let low = MIN_QUALITY;
    let high = MAX_QUALITY;
    for (let i = 0; i < 6; i++) {
      const mid = (low + high) / 2;
      const attempt = await encode(width, height, mid);
      if (attempt && attempt.size <= maxBytes) {
        best = attempt;
        low = mid;
      } else {
        high = mid;
      }
    }
    return best;
  }
  return null;
}

/**
 * Shrinks a photo to under 500 KB at HD size, in the browser, before it is uploaded. A phone photo is
 * often 5 MB; none of that is visible on a trip page. A photo already under the limit goes up as it
 * is. One the browser cannot decode also goes up as it is, and the server's own limit decides.
 */
export async function compressPhoto(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES || !/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const type = supportsWebp() ? "image/webp" : "image/jpeg";

    const fitted = await fitUnderLimit(bitmap, async (width, height, quality) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      // A transparent PNG would turn black as a JPEG, so the picture is laid on white.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      return blob ? { size: blob.size, blob } : null;
    });
    bitmap.close();

    if (!fitted || fitted.size >= file.size) return file;
    const extension = type === "image/webp" ? "webp" : "jpg";
    return new File([fitted.blob], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, { type });
  } catch {
    return file;
  }
}

let webp: boolean | undefined;
function supportsWebp(): boolean {
  webp ??= document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
  return webp;
}

/**
 * Sends one photo to an upload route and returns its public address. Browser-only.
 * Errors carry the server's own wording, which is written for the person who chose the file.
 */
export async function uploadPhoto(file: File, endpoint: string, compress = false): Promise<string> {
  const body = new FormData();
  body.append("file", compress ? await compressPhoto(file) : file);

  const response = await fetch(endpoint, { method: "POST", body });
  const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !payload.url) throw new Error(payload.error ?? "The photo could not be uploaded.");
  return payload.url;
}
