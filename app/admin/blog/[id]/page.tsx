import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BlogEditor from "@/components/admin/blog/BlogEditor";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listBlogCategories, loadAdminBlogPost } from "@/lib/services/blog/posts";
import { toEditorPost } from "@/lib/services/blog/editor-view";

export const metadata = { title: "Edit article · Bluepass Admin" };

export default async function EditBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminOrRedirect(`/admin/blog/${id}`);

  const [post, categories] = await Promise.all([loadAdminBlogPost(id), listBlogCategories()]);

  // A deleted article reached from a stale tab should 404, not render an editor whose Save would
  // silently create a second copy of it.
  if (!post) notFound();

  return (
    <>
      <AdminPageHeader
        context={post.status === "PUBLISHED" ? "Live" : "Draft"}
        title={post.title || "Untitled article"}
        support={
          post.status === "PUBLISHED"
            ? "Edits go live the moment you save. The URL is already indexed — change it only if you have to."
            : "Still invisible to everyone. Publish when the checklist stops arguing with you."
        }
      />
      <BlogEditor post={toEditorPost(post)} categories={categories.map(({ id: cid, name }) => ({ id: cid, name }))} />
    </>
  );
}
