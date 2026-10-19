import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentOperatorAccess } from "@/lib/services/operator/guard";
import { addOwnPhoto, ownPageFor, setOwnLogo } from "@/lib/services/operators/own-media-edits";
import { MAX_UPLOAD_BYTES, prepareUpload } from "@/lib/services/operators/upload-image";
import { storeOperatorMedia } from "@/lib/services/storage/operator-media";

/**
 * One photo or logo from the operator's own computer or phone, for their own page. The
 * browser shrinks each photo before sending it, so a request stays well inside a hosting
 * platform's body limit; here it is checked, re-encoded and stored, then added.
 */
export async function POST(request: Request) {
  const access = await currentOperatorAccess();
  if (!access.ok) return NextResponse.json({ ok: false, message: "Your session has expired. Sign in again and retry." }, { status: 401 });
  const page = await ownPageFor(access.account.id);
  if (!page.ok) return NextResponse.json(page, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "That upload did not arrive whole. Try again." }, { status: 400 });
  }
  const file = form.get("file");
  const kind = form.get("kind") === "logo" ? "logo" : "photo";
  const target = String(form.get("target") ?? "page");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, message: "Choose a photo to upload." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ ok: false, message: "That file is over 12 MB. Try a smaller copy." }, { status: 413 });

  const prepared = await prepareUpload(Buffer.from(await file.arrayBuffer()), kind);
  if (!prepared.ok) return NextResponse.json(prepared, { status: 422 });
  let url: string;
  try {
    url = await storeOperatorMedia({ slug: page.slug, bytes: prepared.bytes, contentType: prepared.contentType, extension: prepared.extension });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "The photo could not be stored. Try again." }, { status: 500 });
  }
  const result = kind === "logo"
    ? await setOwnLogo({ accountId: access.account.id, url, light: prepared.light })
    : await addOwnPhoto({ accountId: access.account.id, url, target });
  if (result.ok) {
    revalidatePath("/operator/your-page");
    revalidatePath(`/operators/${page.slug}`, "layout");
  }
  return NextResponse.json({ ...result, url }, { status: result.ok ? 200 : 400 });
}
