import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

/**
 * Trip photos, uploaded by operators, in the Supabase project this app already uses.
 *
 * Its own bucket, public, because every file in it is embedded in a public trip page: a signed URL
 * would expire and break the page. The bucket provisions itself on the first upload, so the one thing
 * a person has to do by hand is put `SUPABASE_SERVICE_ROLE_KEY` in the environment.
 *
 * Runs server-side only; the service role key must never reach the browser.
 */
const BUCKET = "operator-listings";
/* The browser shrinks every photo to under 500 KB first. This is the safety net for a file it could not
   decode, so it is set above that rather than at it. */
export const MAX_LISTING_IMAGE_BYTES = 1024 * 1024;

/* Only formats a browser renders inline. SVG is left out on purpose: it can carry script, and these
   files are served from a URL a public page embeds. GIF is left out because a trip cover is a photo. */
export const LISTING_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

let cachedClient: ReturnType<typeof createClient> | null = null;
let bucketReady = false;

function getStorageClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Photo upload is not switched on yet. Ask your Bluepass contact to finish setting it up.");
  }

  cachedClient ??= createClient(url, serviceRoleKey);
  return cachedClient;
}

/**
 * Whether an address is a photo in this app's own public bucket. Used before a photo address is saved
 * on a listing: the picker only ever produces these, so anything else arrived by some other route and
 * is not something a public page should embed.
 */
export function isListingImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co") && url.pathname.startsWith(`/storage/v1/object/public/${BUCKET}/`);
  } catch {
    return false;
  }
}

/** What is wrong with this file as a trip photo, in words for the person who chose it. Null when fine. */
export function listingImageProblem(file: { type: string; size: number }): string | null {
  if (!LISTING_IMAGE_TYPES.includes(file.type)) return "Photos must be JPG, PNG, WebP or AVIF.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_LISTING_IMAGE_BYTES) return "That photo is too large and could not be shrunk here. Save it as a JPG and try again.";
  return null;
}

function isMissingBucket(error: { message?: string; statusCode?: string } | null) {
  return Boolean(error) && (/bucket not found/i.test(error?.message ?? "") || error?.statusCode === "404");
}

async function ensureBucket(client: ReturnType<typeof createClient>) {
  if (bucketReady) return;

  const { error } = await client.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_LISTING_IMAGE_BYTES,
    allowedMimeTypes: LISTING_IMAGE_TYPES,
  });

  if (error && !/already exists/i.test(error.message)) {
    throw new Error("Photo storage could not be prepared. Ask your Bluepass contact to check the storage setup.");
  }
  bucketReady = true;
}

/** Stores one trip photo and returns the public address to save on the listing. */
export async function uploadListingImage(file: File, accountId: string): Promise<string> {
  const problem = listingImageProblem(file);
  if (problem) throw new Error(problem);

  const client = getStorageClient();
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${accountId}/${randomUUID()}.${extension}`;

  const put = () =>
    client.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
      // The name is a UUID, so these bytes can never change under that address.
      cacheControl: "31536000",
    });

  let { error } = await put();
  if (isMissingBucket(error)) {
    await ensureBucket(client);
    ({ error } = await put());
  }
  if (error) throw new Error("The photo could not be uploaded. Try again in a moment.");

  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
