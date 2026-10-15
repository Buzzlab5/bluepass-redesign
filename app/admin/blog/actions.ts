"use server";

import "@/lib/validation/zod-messages";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCurrentAdmin } from "@/lib/services/auth/admin";
import {
  deleteBlogCategory,
  deleteBlogPost,
  saveBlogCategory,
  saveBlogPost,
  type BlogPostInput,
} from "@/lib/services/blog/posts";

/**
 * Every write the blog console makes.
 *
 * `requireCurrentAdmin()` is called at the top of each one. The layout's gate only proves the
 * account was an admin when the page rendered — a tab left open after the role was removed still
 * holds a live Publish button, and publishing is a public, indexable act.
 */

export type BlogActionState =
  | { status: "idle" }
  | { status: "saved"; message: string; id: string; slug: string }
  | { status: "error"; message: string };

async function requireAdmin() {
  const admin = await requireCurrentAdmin();
  if (!admin) throw new Error("Not authorised.");
  return admin;
}

/**
 * Anything that changed could have changed a public page: the article itself, the listing, the
 * category archive it belongs to, and the sitemap. Revalidating all four is cheap and the
 * alternative — a published article that 404s until the next deploy — is the failure everyone
 * remembers.
 */
function revalidateBlog(slug?: string) {
  revalidatePath("/blog");
  revalidatePath("/blog/category/[slug]", "page");
  revalidatePath("/sitemap.xml");
  if (slug) revalidatePath(`/blog/${slug}`);
}

export async function saveBlogPostAction(
  id: string | null,
  input: BlogPostInput,
  previousSlug?: string,
): Promise<BlogActionState> {
  try {
    await requireAdmin();
    const saved = await saveBlogPost(id, input);

    revalidateBlog(saved.slug);
    // A renamed slug leaves its old URL cached and still rendering. Flush that too, so the stale
    // address 404s immediately rather than serving a copy of the article from two names at once.
    if (previousSlug && previousSlug !== saved.slug) revalidatePath(`/blog/${previousSlug}`);
    revalidatePath("/admin/blog");

    return {
      status: "saved",
      message:
        saved.status === "PUBLISHED"
          ? "Published. It is live on /blog and in the sitemap."
          : "Draft saved. Nobody can see it until you publish.",
      id: saved.id,
      slug: saved.slug,
    };
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
}

export async function deleteBlogPostAction(id: string, slug: string): Promise<BlogActionState> {
  try {
    await requireAdmin();
    await deleteBlogPost(id);

    revalidateBlog(slug);
    revalidatePath("/admin/blog");

    return { status: "saved", message: "Article deleted.", id, slug };
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
}

const categorySchema = z.object({
  name: z.string().trim().min(2, "Give the category a name.").max(80),
  description: z.string().trim().max(300).optional(),
  position: z.coerce.number().int().min(0).max(999).optional(),
});

export async function saveBlogCategoryAction(id: string | null, formData: FormData): Promise<BlogActionState> {
  try {
    await requireAdmin();
    const parsed = categorySchema.parse({
      name: formData.get("name") ?? "",
      description: formData.get("description") ?? "",
      position: formData.get("position") ?? 0,
    });

    const savedId = await saveBlogCategory(id, parsed.name, parsed.description ?? "", parsed.position ?? 0);

    revalidateBlog();
    revalidatePath("/admin/blog/categories");

    return { status: "saved", message: id ? "Category updated." : "Category added.", id: savedId, slug: "" };
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
}

export async function deleteBlogCategoryAction(id: string): Promise<BlogActionState> {
  try {
    await requireAdmin();
    await deleteBlogCategory(id);

    revalidateBlog();
    revalidatePath("/admin/blog/categories");

    // Worth stating plainly in the UI: the posts survive, they just become unfiled. An admin who
    // expected a cascade would otherwise assume they had just deleted a month of writing.
    return { status: "saved", message: "Category deleted. Its articles are still there, now unfiled.", id, slug: "" };
  } catch (error) {
    return { status: "error", message: messageFor(error) };
  }
}

function messageFor(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "That did not validate.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong saving that.";
}
