/**
 * Sends one photo to an upload route and returns its public address. Browser-only.
 *
 * A photo larger than `maxDimension` is scaled down first, because a phone photo is often 6 MB for no
 * visible gain on a trip page. Errors carry the server's own wording, which is written for the person
 * who chose the file.
 */
export async function uploadPhoto(file: File, endpoint: string, maxDimension?: number): Promise<string> {
  const body = new FormData();
  body.append("file", maxDimension ? await shrink(file, maxDimension) : file);

  const response = await fetch(endpoint, { method: "POST", body });
  const payload = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !payload.url) throw new Error(payload.error ?? "The photo could not be uploaded.");
  return payload.url;
}

/**
 * Scales a photo down so its long side is at most `max` pixels and re-encodes it as JPEG.
 * A photo already small enough, or one the browser cannot decode, goes up exactly as chosen, so this
 * can only ever make an upload lighter, never fail it.
 */
async function shrink(file: File, max: number): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
