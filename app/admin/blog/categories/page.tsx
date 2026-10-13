import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import CategoryManager from "@/components/admin/blog/CategoryManager";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listBlogCategories } from "@/lib/services/blog/posts";

export const metadata = { title: "Blog categories · Bluepass Admin" };

export default async function BlogCategoriesPage() {
  await requireAdminOrRedirect("/admin/blog/categories");

  const categories = await listBlogCategories();

  return (
    <>
      <AdminPageHeader
        title="Categories"
        support="Each category gets its own indexable archive at /blog/category/…, which is a second route into the articles filed under it. Keep them few and keep them real — five categories with four articles each beat twenty with one."
        aside={
          <Link href="/admin/blog" className="ds-micro bpl__head-link">
            ← All articles
          </Link>
        }
      />
      <CategoryManager categories={categories} />
    </>
  );
}
