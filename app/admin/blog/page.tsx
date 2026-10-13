import Link from "next/link";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BlogPostList from "@/components/admin/blog/BlogPostList";
import { requireAdminOrRedirect } from "@/lib/services/admin/guard";
import { listAdminBlogPosts, listBlogCategories } from "@/lib/services/blog/posts";

export const metadata = { title: "Blog · Bluepass Admin" };

/**
 * The blog console's index.
 *
 * The four numbers across the top are chosen to answer "is this working" rather than to fill a
 * row: how much is actually live, how much is stuck in draft, how much is published but not
 * optimised (the silent failure), and how much reading material Bluepass now owns.
 */
export default async function AdminBlogPage() {
  await requireAdminOrRedirect("/admin/blog");

  const [posts, categories] = await Promise.all([listAdminBlogPosts(), listBlogCategories()]);

  const live = posts.filter((post) => post.status === "PUBLISHED");
  const drafts = posts.filter((post) => post.status === "DRAFT");
  const unoptimised = posts.filter((post) => !post.focusKeyword || !post.metaDescription);
  const minutes = live.reduce((total, post) => total + post.readingMinutes, 0);

  return (
    <>
      <AdminPageHeader
        title="Everything Bluepass has published"
        support="Each article is one more Bluepass result on page one. Write for a single keyword, link back to the pages that convert, and keep publishing."
        aside={
          <div className="bpl__head-actions">
            <Link href="/admin/blog/categories" className="ds-micro bpl__head-link">
              Categories ({categories.length})
            </Link>
            <Link href="/admin/blog/new" className="bpl__new">
              New article
            </Link>
          </div>
        }
      />

      <div className="bpl__stats">
        <Stat value={live.length} label="Live on the site" />
        <Stat value={drafts.length} label="In draft" />
        <Stat
          value={unoptimised.length}
          label="Missing keyword or description"
          tone={unoptimised.length > 0 ? "warn" : undefined}
        />
        <Stat value={minutes} label="Minutes of content owned" />
      </div>

      <BlogPostList posts={posts} />
    </>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "warn" }) {
  return (
    <div className={`bpl-stat${tone ? ` bpl-stat--${tone}` : ""}`}>
      <span className="ds-display-md bpl-stat__value">{value}</span>
      <span className="ds-micro bpl-stat__label">{label}</span>
    </div>
  );
}
