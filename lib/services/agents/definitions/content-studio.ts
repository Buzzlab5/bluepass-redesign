/**
 * Agent 12 · Content studio (Wave 2).
 *
 * Writes the articles that bring travellers in from search. Worth running
 * before there is anything to sell, because search rankings compound over
 * months and the work done now is what is ranking when supply arrives.
 *
 * Everything it writes lands as a draft. It cannot publish. That is not
 * caution about quality: it is that a published page is the most public
 * thing BluePass produces, it is indexed, and an error on it is permanent
 * in a way an email to one operator is not.
 *
 * The rule it exists under: an article may only describe trips that are
 * actually bookable, or describe a place without implying BluePass can
 * sell it. Writing "book your Ningaloo whale shark swim with BluePass"
 * when no operator there is live is the kind of lie search engines reward
 * briefly and travellers punish permanently.
 */

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyOutbound } from "./verifier";
import type { AgentDefinition, AgentTool, RunContext } from "../runtime/types";

export const CONTENT_STUDIO_ID = "content-studio";

const MIN_WORDS = 500;

const readCatalogue: AgentTool = {
  name: "read_what_exists",
  description:
    "What BluePass can actually write about honestly: the live listings and their regions, plus what has already been published so you do not repeat it. Call this first.",
  schema: z.object({}),
  run: async (_input, ctx) => {
    const [listings, posts, categories] = await Promise.all([
      prisma.operatorListing.findMany({
        where: { status: "LIVE" },
        select: { title: true, region: true, category: true, description: true },
        take: 120,
      }),
      prisma.blogPost.findMany({
        orderBy: { updatedAt: "desc" },
        take: 60,
        select: { title: true, slug: true, focusKeyword: true, status: true, tags: true },
      }),
      prisma.blogCategory.findMany({ select: { id: true, name: true, slug: true }, orderBy: { position: "asc" } }),
    ]);

    const regions = [...new Set(listings.map((l) => l.region).filter(Boolean))];
    ctx.outcome.liveListings = listings.length;
    ctx.outcome.existingPosts = posts.length;

    return [
      `LIVE, BOOKABLE LISTINGS (${listings.length}). These are the only trips you may tell a reader they can book:`,
      ...(listings.length === 0
        ? [
            "  none.",
            "  Nothing is bookable yet. You may still write about a place, a species or a season, but you must not imply BluePass can sell a trip there. No call to action that says book. Write for the reader who is researching, and say nothing about availability.",
          ]
        : listings.slice(0, 40).map((l) => `  ${l.region} · ${l.category} · ${l.title}`)),
      "",
      `Regions with something live: ${regions.length ? regions.join(", ") : "none"}`,
      "",
      `ALREADY WRITTEN (${posts.length}) — do not duplicate a focus keyword:`,
      ...posts.slice(0, 30).map((p) => `  [${p.status}] ${p.title} · keyword: ${p.focusKeyword ?? "none"} · /${p.slug}`),
      "",
      `CATEGORIES: ${categories.map((c) => `${c.name} (${c.id})`).join(", ") || "none defined"}`,
    ].join("\n");
  },
};

const draftArticle: AgentTool = {
  name: "draft_article",
  description:
    "Save an article as a draft. It is never published; a person does that. The body must have passed verify_outbound in this run. Do not reuse a focus keyword that already exists.",
  schema: z.object({
    title: z.string().min(10).max(160),
    slug: z
      .string()
      .min(3)
      .max(90)
      .regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and hyphens only"),
    focus_keyword: z.string().min(3).max(90).describe("What a reader would actually type into search."),
    body_markdown: z.string().min(400).describe("The article. Markdown."),
    excerpt: z.string().min(40).max(300),
    meta_description: z.string().min(50).max(160).describe("Search snippet. Under 160 characters."),
    category_id: z.string().optional(),
    tags: z.array(z.string().max(40)).max(8).optional(),
    mentions_bookable_trips: z
      .boolean()
      .describe("True only if every trip you invited the reader to book is in the live list."),
  }),
  writes: true,
  run: async (input, ctx) => {
    const verifications = (ctx.outcome.verifications as { pass: boolean }[] | undefined) ?? [];
    if (verifications.length === 0 || !verifications[verifications.length - 1].pass) {
      return "Refused: the copy rules have not passed on this article. Run verify_outbound on the body first.";
    }

    const words = input.body_markdown.trim().split(/\s+/).length;
    if (words < MIN_WORDS) {
      return `Refused: ${words} words. An article this thin will not rank and is not worth a reader's time. Write at least ${MIN_WORDS}, or do not write it.`;
    }

    const clash = await prisma.blogPost.findFirst({
      where: { OR: [{ slug: input.slug }, { focusKeyword: input.focus_keyword }] },
      select: { slug: true, title: true, focusKeyword: true },
    });
    if (clash) {
      return `Refused: "${clash.title}" already uses ${clash.slug === input.slug ? `the slug /${input.slug}` : `the keyword "${input.focus_keyword}"`}. Two pages competing for one keyword split their own ranking. Pick a different angle or improve the existing page instead.`;
    }

    // The honesty gate. If nothing is live, an article that invites a
    // booking is a promise BluePass cannot keep, and it is indexed.
    if (input.mentions_bookable_trips) {
      const liveCount = await prisma.operatorListing.count({ where: { status: "LIVE" } });
      if (liveCount === 0) {
        return "Refused: you marked this as inviting the reader to book, and nothing is bookable. Rewrite it for a reader who is researching, with no call to action that says book, and set mentions_bookable_trips to false.";
      }
    }

    const post = await prisma.blogPost.create({
      data: {
        title: input.title,
        slug: input.slug,
        bodyMarkdown: input.body_markdown,
        excerpt: input.excerpt,
        focusKeyword: input.focus_keyword,
        seoTitle: input.title.slice(0, 60),
        metaDescription: input.meta_description,
        categoryId: input.category_id,
        tags: input.tags ?? [],
        status: "DRAFT",
        wordCount: words,
        readingMinutes: Math.max(1, Math.round(words / 220)),
      },
      select: { id: true, slug: true },
    });

    const drafted = (ctx.outcome.drafted as unknown[] | undefined) ?? [];
    ctx.outcome.drafted = [...drafted, { id: post.id, slug: post.slug, words }];
    ctx.log(`drafted /${post.slug} (${words} words)`);

    const r = await ctx.requestDecision({
      kind: "article.drafted",
      title: `Article ready to read: ${input.title}`,
      summary: [
        `/${post.slug} · ${words} words · keyword "${input.focus_keyword}"`,
        "",
        input.excerpt,
        "",
        "It is a draft and is not indexed. Publish it from the blog admin if it is right.",
      ].join("\n"),
      payload: { postId: post.id, slug: post.slug },
      options: ["read it", "discard"],
      entityType: "BlogPost",
      entityId: post.id,
    });
    return `Saved as a draft at /${post.slug}, ${words} words. Flagged for a read (decision ${r.decisionId}). It is not published and you cannot publish it.`;
  },
};

export const contentStudioAgent: AgentDefinition = {
  id: CONTENT_STUDIO_ID,
  name: "Content studio",
  desk: "travellers",
  plane: "operating",
  wave: 2,
  modelTier: "reasoning",
  persona: `You write the articles that bring travellers to BluePass from search. BluePass is a marine-tourism marketplace working in Australia and Indonesia, where a fixed 5% of every booking goes to ocean conservation.

Everything you write is a draft. You cannot publish and you should not want to: a published page is the most public thing BluePass makes, it gets indexed, and a mistake on it outlives a mistake anywhere else.

The rule that governs every article: you may only invite a reader to book a trip that is actually live. Call read_what_exists first and take it literally. If nothing is bookable, you can still write well about a place, a species, a season or how to choose an operator, but there is no call to action, no implication that BluePass can sell it, and nothing about availability. An article that promises a booking BluePass cannot deliver is the kind of thing search rewards for a fortnight and a traveller remembers for years.

Write for a person deciding on a trip, not for a search engine:
- Answer the question in the title, properly, in the first two paragraphs. Somebody skimming should get their answer even if they leave.
- Be specific and be right. Seasons, water temperature, what you actually see, how far the boat goes, what the certification requirements are. If you do not know something, leave it out rather than generalising. You have no research tool: everything must come from what read_what_exists returned or from what is genuinely settled general knowledge about a place.
- Never invent an operator, a price, a departure, a review or a statistic. Never name a conservation organisation as a BluePass partner unless it was in what you read.
- The conservation line is one sentence, said plainly once. It is not the subject of the article unless the article is about conservation.

One keyword per article, and never one that already exists. Two BluePass pages competing for the same search split their own ranking, which is worse than not writing the second one.

Length is a floor, not a target. Five hundred words minimum because anything thinner will not rank, but a tight eight hundred beats a padded two thousand. Do not write filler to reach a number.

Rules you cannot bend: run verify_outbound on the body before drafting; the only percentage you may state is the fixed 5% to the ocean; no emojis; no em dashes; never claim to be a person.`,
  triggers: [{ type: "schedule", cadence: "weekly" }, { type: "manual" }],
  tools: [readCatalogue, verifyOutbound, draftArticle],
  gates: [{ kind: "article.drafted", assignee: "tony", defaultAction: "hold", ttlHours: 168 }],
  budget: { maxRunsPerDay: 3, maxTokensPerRun: 24_000, maxIterations: 20 },
  buildTask: async (payload, ctx: RunContext) => {
    if (payload.decision) return { skip: "an article draft was read by a person" };
    const topic = typeof payload.topic === "string" ? payload.topic : null;
    ctx.log(topic ? `writing on ${topic}` : "choosing a subject");
    return {
      task: `Write one article for the BluePass blog${topic ? ` on: ${topic}` : ""}.

Start with read_what_exists. Choose a subject that does not compete with anything already written, and that you can be specific and accurate about. Write it, verify it, then draft it.

If nothing is bookable, write for a reader who is researching and invite them to nothing.`,
    };
  },
};
