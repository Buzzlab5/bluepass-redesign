"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import Notice from "@/components/auth/Notice";
import ImagePicker from "@/components/admin/blog/ImagePicker";
import MarkdownField from "@/components/admin/blog/MarkdownField";
import SeoPanel from "@/components/admin/blog/SeoPanel";
import TagInput from "@/components/admin/blog/TagInput";
import { deleteBlogPostAction, saveBlogPostAction, type BlogActionState } from "@/app/admin/blog/actions";
import { analyseSeo, effectiveMetaDescription, effectiveSeoTitle } from "@/lib/services/blog/seo";
import { slugify } from "@/lib/services/blog/slug";

/**
 * The article editor — one component for both "new" and "edit", because they are the same form
 * with a different starting point, and two copies would drift the moment a field was added.
 *
 * State is held here rather than in the DOM so the SEO rail can recompute on every keystroke: the
 * point of this screen is that an author sees the consequence of a thin meta description while
 * they are still writing it, not after they save.
 */

export type BlogEditorPost = {
  id: string | null;
  title: string;
  slug: string;
  authorName: string;
  bodyMarkdown: string;
  excerpt: string;
  tags: string[];
  categoryId: string;
  heroImageUrl: string;
  heroImageAlt: string;
  focusKeyword: string;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  structuredData: "ARTICLE" | "FAQ_PAGE" | "HOW_TO";
  noindex: boolean;
  shareTitle: string;
  shareDescription: string;
  shareImageUrl: string;
  status: "DRAFT" | "PUBLISHED";
  /**
   * `datetime-local` shape (YYYY-MM-DDTHH:mm) read and written as UTC, or empty for "stamp it the
   * moment it goes live". UTC rather than browser-local on purpose: the value is rendered on the
   * server and edited in the browser, and letting those two disagree about the timezone is how a
   * scheduled post appears seven hours early.
   */
  publishedAt: string;
};

const STRUCTURED_DATA_OPTIONS: { value: BlogEditorPost["structuredData"]; label: string; hint: string }[] = [
  { value: "ARTICLE", label: "Article", hint: "The default. Right for every ordinary post." },
  { value: "FAQ_PAGE", label: "FAQ", hint: "For a page built as questions and answers." },
  { value: "HOW_TO", label: "How-to", hint: "For a page built as ordered steps." },
];

export default function BlogEditor({
  post,
  categories,
}: {
  post: BlogEditorPost;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(post);
  const [saved, setSaved] = useState(post);
  const [state, setState] = useState<BlogActionState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /* Once the URL has been typed by hand it stops following the title. A slug that quietly rewrote
     itself under an author who had deliberately shortened it would be the worst kind of helpful. */
  const [slugLocked, setSlugLocked] = useState(Boolean(post.slug));

  const set = <K extends keyof BlogEditorPost>(key: K, value: BlogEditorPost[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const effectiveSlug = slugLocked ? slugify(form.slug) : slugify(form.title);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  const report = useMemo(
    () =>
      analyseSeo({
        title: form.title,
        slug: effectiveSlug,
        body: form.bodyMarkdown,
        excerpt: form.excerpt,
        focusKeyword: form.focusKeyword,
        seoTitle: form.seoTitle,
        metaDescription: form.metaDescription,
        heroImageUrl: form.heroImageUrl,
        heroImageAlt: form.heroImageAlt,
        categoryId: form.categoryId,
        tags: form.tags,
      }),
    [form, effectiveSlug],
  );

  const searchTitle = effectiveSeoTitle(form);
  const searchDescription = effectiveMetaDescription({
    metaDescription: form.metaDescription,
    excerpt: form.excerpt,
    body: form.bodyMarkdown,
  });

  /* Closing the tab mid-article is the one unrecoverable mistake this screen allows. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const submit = (status: BlogEditorPost["status"]) => {
    const next = { ...form, slug: effectiveSlug, status };
    setForm(next);
    setState({ status: "idle" });

    startTransition(async () => {
      const result = await saveBlogPostAction(
        post.id,
        {
          ...next,
          // The field is UTC (see the type), so pin the zone rather than letting `new Date` read
          // it as whatever the editing browser happens to be set to.
          publishedAt: next.publishedAt ? new Date(`${next.publishedAt}:00Z`) : undefined,
        },
        post.slug || undefined,
      );

      setState(result);

      if (result.status === "saved") {
        // The server is the authority on the slug — it may have suffixed it past a collision.
        const settled = { ...next, slug: result.slug };
        setForm(settled);
        setSaved(settled);
        setSlugLocked(true);
        // A newly created post has been living at /admin/blog/new; move it to its real address so a
        // refresh does not offer to create a second copy.
        if (!post.id) router.replace(`/admin/blog/${result.id}`);
        else router.refresh();
      }
    });
  };

  const remove = () => {
    if (!post.id) return;
    startTransition(async () => {
      const result = await deleteBlogPostAction(post.id!, post.slug);
      if (result.status === "saved") window.location.assign("/admin/blog");
      else setState(result);
    });
  };

  return (
    <div className="bpe">
      <div className="bpe__bar">
        <div className="bpe__bar-left">
          <Link href="/admin/blog" className="ds-micro bpe__back">
            ← All articles
          </Link>
          <span className={`ds-micro bpe__chip bpe__chip--${form.status.toLowerCase()}`}>
            {form.status === "PUBLISHED" ? "Published" : "Draft"}
          </span>
          <span className="ds-micro bpe__dirty">
            {pending ? "Saving…" : dirty ? "Unsaved changes" : post.id ? "All changes saved" : "Not saved yet"}
          </span>
        </div>
        <div className="bpe__bar-right">
          <button type="button" className="bpe__btn" onClick={() => submit("DRAFT")} disabled={pending}>
            Save draft
          </button>
          <button
            type="button"
            className="bpe__btn bpe__btn--primary"
            onClick={() => submit("PUBLISHED")}
            disabled={pending}
          >
            {form.status === "PUBLISHED" ? "Update live article" : "Publish"}
          </button>
        </div>
      </div>

      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "saved" ? <Notice tone="success">{state.message}</Notice> : null}

      <div className="bpe__grid">
        <div className="bpe__main">
          {/* 1 — the article ------------------------------------------------------------- */}
          <section className="bpe-card">
            <input
              className="bpe-title"
              value={form.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder="The question this article answers"
              aria-label="Article title"
            />

            <div className="bpe-slug">
              <span className="ds-micro bpe-slug__prefix">bluepass.co/blog/</span>
              <input
                className="bpe-slug__input"
                value={slugLocked ? form.slug : effectiveSlug}
                onChange={(event) => {
                  setSlugLocked(true);
                  set("slug", event.target.value);
                }}
                placeholder="follows-the-title"
                aria-label="URL slug"
              />
              {/* Only once the URL is actually load-bearing. On a draft, changing the slug costs
                  nothing, and a warning that cries wolf on every article teaches people to ignore
                  it on the one where it matters. */}
              {form.status === "PUBLISHED" && post.id ? (
                <span className="ds-micro bpe-slug__warn" title="Changing a published URL breaks every link to it">
                  Live URL
                </span>
              ) : null}
            </div>

            <div className="bpe-row bpe-row--three">
              <Labelled label="Author" hint="The byline on the article">
                <input
                  className="bpe-input"
                  value={form.authorName}
                  onChange={(event) => set("authorName", event.target.value)}
                  placeholder="Bluepass"
                />
              </Labelled>

              <Labelled label="Category" hint="An extra indexable archive page">
                <select
                  className="bpe-input bpe-select"
                  value={form.categoryId}
                  onChange={(event) => set("categoryId", event.target.value)}
                >
                  <option value="">Unfiled</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Labelled>

              <Labelled label="Tags" hint="Drives related articles">
                <TagInput tags={form.tags} onChange={(tags) => set("tags", tags)} />
              </Labelled>
            </div>
          </section>

          {/* 2 — the body --------------------------------------------------------------- */}
          <section className="bpe-card">
            <SectionHead
              step="01"
              title="The article"
              note="Answer the question in the first paragraph, then earn the rest. Every ## becomes a section in the contents rail."
            />
            <MarkdownField
              value={form.bodyMarkdown}
              onChange={(value) => set("bodyMarkdown", value)}
              words={report.stats.wordCount}
              minutes={report.stats.readingMinutes}
            />

            <Labelled label="Excerpt" hint={`${form.excerpt.length}/300 · the card on /blog, not the Google snippet`}>
              <textarea
                className="bpe-input bpe-textarea"
                value={form.excerpt}
                onChange={(event) => set("excerpt", event.target.value)}
                rows={2}
                maxLength={300}
                placeholder="One or two sentences that make someone open it."
              />
            </Labelled>
          </section>

          {/* 3 — imagery ----------------------------------------------------------------- */}
          <section className="bpe-card">
            <SectionHead
              step="02"
              title="Featured image"
              note="The header on the article, the thumbnail on /blog, and the card every share falls back to."
            />
            <ImagePicker
              label="Image"
              hint="1200 × 630 or larger"
              value={form.heroImageUrl}
              onChange={(url) => set("heroImageUrl", url)}
            />
            <Labelled label="Alt text" hint="What Google Images and a screen reader read">
              <input
                className="bpe-input"
                value={form.heroImageAlt}
                onChange={(event) => set("heroImageAlt", event.target.value)}
                placeholder="e.g. A dive boat at anchor off Komodo at first light"
              />
            </Labelled>
          </section>

          {/* 4 — search appearance -------------------------------------------------------- */}
          <section className="bpe-card">
            <SectionHead
              step="03"
              title="Search appearance"
              note="What Google shows. Left empty, each of these falls back to the article's own title and opening — the checklist says when that is costing you."
            />

            <Labelled label="Focus keyword" hint="One phrase per article">
              <input
                className="bpe-input"
                value={form.focusKeyword}
                onChange={(event) => set("focusKeyword", event.target.value)}
                placeholder="e.g. liveaboard komodo"
              />
            </Labelled>

            <Labelled label="Search title" hint={`${searchTitle.length}/60 · falls back to the article title`}>
              <input
                className="bpe-input"
                value={form.seoTitle}
                onChange={(event) => set("seoTitle", event.target.value)}
                placeholder={form.title || "Falls back to the article title"}
              />
              <Meter value={searchTitle.length} good={[30, 60]} hard={70} />
            </Labelled>

            <Labelled label="Meta description" hint={`${form.metaDescription.length}/160`}>
              <textarea
                className="bpe-input bpe-textarea"
                value={form.metaDescription}
                onChange={(event) => set("metaDescription", event.target.value)}
                rows={3}
                placeholder="The sentence under the title in Google. Say what the reader gets, and use the keyword once."
              />
              <Meter value={form.metaDescription.length} good={[70, 160]} hard={180} />
            </Labelled>

            <Labelled label="Canonical URL" hint="Only if this was published somewhere else first">
              <input
                className="bpe-input"
                value={form.canonicalUrl}
                onChange={(event) => set("canonicalUrl", event.target.value)}
                placeholder={`https://bluepass.co/blog/${effectiveSlug || "…"}`}
                inputMode="url"
              />
            </Labelled>

            <Labelled label="Structured data" hint="Emitted as JSON-LD alongside breadcrumbs and organisation markup">
              <div className="bpe-choice">
                {STRUCTURED_DATA_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`bpe-choice__opt${form.structuredData === option.value ? " is-active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="structuredData"
                      checked={form.structuredData === option.value}
                      onChange={() => set("structuredData", option.value)}
                    />
                    <span className="ds-body-sm bpe-choice__label">{option.label}</span>
                    <span className="ds-micro bpe-choice__hint">{option.hint}</span>
                  </label>
                ))}
              </div>
            </Labelled>

            <Toggle
              checked={form.noindex}
              onChange={(value) => set("noindex", value)}
              label="Hide from search engines"
              hint="Adds noindex and drops the article from the sitemap. For announcements you want online but not ranking."
            />
          </section>

          {/* 5 — social ------------------------------------------------------------------- */}
          <section className="bpe-card">
            <SectionHead
              step="04"
              title="Sharing"
              note="How the link unfurls on WhatsApp, Slack, LinkedIn and X. Every field falls back to its search equivalent."
            />
            <Labelled label="Share title" hint="Falls back to the search title">
              <input
                className="bpe-input"
                value={form.shareTitle}
                onChange={(event) => set("shareTitle", event.target.value)}
                placeholder={searchTitle || "Falls back to the search title"}
              />
            </Labelled>
            <Labelled label="Share description" hint="Falls back to the meta description">
              <textarea
                className="bpe-input bpe-textarea"
                value={form.shareDescription}
                onChange={(event) => set("shareDescription", event.target.value)}
                rows={2}
                placeholder={searchDescription || "Falls back to the meta description"}
              />
            </Labelled>
            <ImagePicker
              label="Share image"
              hint="Falls back to the featured image"
              value={form.shareImageUrl}
              onChange={(url) => set("shareImageUrl", url)}
            />
          </section>

          {/* 6 — publishing --------------------------------------------------------------- */}
          <section className="bpe-card">
            <SectionHead
              step="05"
              title="Publishing"
              note="A draft is invisible to everyone, including crawlers. A future date is a schedule — the article appears on its own."
            />

            <Labelled label="Publish date (UTC)" hint="Leave blank to stamp it the moment it goes live">
              <input
                type="datetime-local"
                className="bpe-input"
                value={form.publishedAt}
                onChange={(event) => set("publishedAt", event.target.value)}
              />
            </Labelled>

            {post.id ? (
              <div className="bpe-danger">
                {confirmingDelete ? (
                  <>
                    <span className="ds-body-sm bpe-danger__copy">
                      Delete “{form.title || "this article"}” for good? Any link to it starts returning a 404.
                    </span>
                    <div className="bpe-danger__row">
                      <button type="button" className="bpe__btn" onClick={() => setConfirmingDelete(false)}>
                        Keep it
                      </button>
                      <button type="button" className="bpe__btn bpe__btn--danger" onClick={remove} disabled={pending}>
                        Delete permanently
                      </button>
                    </div>
                  </>
                ) : (
                  <button type="button" className="ds-micro bpe-danger__trigger" onClick={() => setConfirmingDelete(true)}>
                    Delete this article
                  </button>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="bpe__rail">
          <SeoPanel
            report={report}
            serp={{ title: searchTitle, description: searchDescription, slug: effectiveSlug }}
            social={{
              title: form.shareTitle || searchTitle,
              description: form.shareDescription || searchDescription,
              image: form.shareImageUrl || form.heroImageUrl,
            }}
          />
          {form.status === "PUBLISHED" && form.slug ? (
            <a className="ds-micro bpe-rail__view" href={`/blog/${form.slug}`} target="_blank" rel="noreferrer">
              View it live ↗
            </a>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function SectionHead({ step, title, note }: { step: string; title: string; note: string }) {
  return (
    <div className="bpe-head">
      <span className="ds-micro bpe-head__step">{step}</span>
      <div className="bpe-head__copy">
        <h2 className="ds-body-lg bpe-head__title">{title}</h2>
        <p className="ds-micro bpe-head__note">{note}</p>
      </div>
    </div>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="bpe-field">
      <span className="afield__top">
        <span className="ds-micro afield__label">{label}</span>
        {hint ? <span className="ds-micro afield__hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** The length bar under a title/description field — a range, drawn as a range. */
function Meter({ value, good, hard }: { value: number; good: [number, number]; hard: number }) {
  const ratio = Math.min(value / hard, 1);
  const tone = value === 0 ? "empty" : value < good[0] ? "warn" : value <= good[1] ? "good" : "bad";

  return (
    <span className="bpe-meter" aria-hidden>
      <span className={`bpe-meter__fill bpe-meter__fill--${tone}`} style={{ width: `${ratio * 100}%` }} />
      <span className="bpe-meter__marks" style={{ left: `${(good[0] / hard) * 100}%`, right: `${100 - (good[1] / hard) * 100}%` }} />
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="bpe-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="bpe-toggle__track" aria-hidden>
        <span className="bpe-toggle__knob" />
      </span>
      <span className="bpe-toggle__copy">
        <span className="ds-body-sm bpe-toggle__label">{label}</span>
        <span className="ds-micro bpe-toggle__hint">{hint}</span>
      </span>
    </label>
  );
}
