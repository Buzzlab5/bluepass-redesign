import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Photos and logos operators upload to their own prepared page, in the same Supabase
 * project as the blog's images but a bucket of their own. Public, because every file is
 * shown on a public page; the bucket creates itself on the first upload, as the blog's does.
 *
 * Away from production with no Supabase key, files land in public/dev-uploads (ignored by
 * git) so the whole flow can be tried locally.
 */
const BUCKET = "operator-media";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

let cachedClient: ReturnType<typeof createClient> | null = null;
let bucketReady = false;

function storageClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cachedClient ??= createClient(url, key);
  return cachedClient;
}

async function ensureBucket(client: ReturnType<typeof createClient>) {
  if (bucketReady) return;
  const { error } = await client.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ALLOWED_TYPES });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Could not create the "${BUCKET}" storage bucket: ${error.message}.`);
  }
  bucketReady = true;
}

/** Stores a prepared upload (see `prepareUpload`) and returns the address the page shows it from. */
export async function storeOperatorMedia(input: { slug: string; bytes: Buffer; contentType: string; extension: string }): Promise<string> {
  if (!ALLOWED_TYPES.includes(input.contentType)) throw new Error("Only prepared JPG and PNG files are stored.");
  const path = `${input.slug.replace(/[^a-z0-9-]/g, "")}/${randomUUID()}.${input.extension}`;
  const client = storageClient();

  if (!client) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Photo upload is not set up yet: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed.");
    }
    const folder = join(process.cwd(), "public", "dev-uploads", BUCKET);
    await mkdir(join(folder, path, ".."), { recursive: true });
    await writeFile(join(folder, path), input.bytes);
    return `/dev-uploads/${BUCKET}/${path}`;
  }

  const put = () => client.storage.from(BUCKET).upload(path, input.bytes, { contentType: input.contentType, upsert: false, cacheControl: "31536000" });
  let { error } = await put();
  if (error && (/bucket not found/i.test(error.message) || (error as { statusCode?: string }).statusCode === "404")) {
    await ensureBucket(client);
    ({ error } = await put());
  }
  if (error) throw new Error(`Unable to store the photo: ${error.message}`);
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
