import { NextResponse } from "next/server";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import { uploadListingImage } from "@/lib/services/storage/listing-images";

/**
 * Trip photo upload.
 *
 * A route handler, not a server action, because the picker uploads the moment a file is chosen and
 * needs the address back to show the preview. It checks the operator itself: the console layout only
 * guards what an operator can see, and this endpoint writes to a public bucket.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const access = await currentOperatorAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in as an operator to upload photos." }, { status: 403 });

  let file: File | null = null;
  try {
    const entry = (await request.formData()).get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: "That upload could not be read. Try again." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Choose a photo first." }, { status: 400 });

  try {
    return NextResponse.json({ url: await uploadListingImage(file, access.account.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The photo could not be uploaded." }, { status: 400 });
  }
}
