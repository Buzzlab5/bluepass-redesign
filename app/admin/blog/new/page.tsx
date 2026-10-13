import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BlogEditor from "@/components/admin/blog/BlogEditor";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listBlogCategories } from "@/lib/services/blog/posts";
import { EMPTY_EDITOR_POST } from "@/lib/services/blog/editor-view";

export const metadata = { title: "New article · Bluepass Admin" };

export default async function NewBlogPostPage() {
  await requireAdminOrRedirect("/admin/blog/new");

  const categories = await listBlogCategories();

  return (
    <>
      <AdminPageHeader
        title="Untitled article"
        support="Nothing here is visible to anyone — not a reader, not a crawler — until you publish it."
      />
      <BlogEditor post={EMPTY_EDITOR_POST} categories={categories.map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
