import { describe, expect, it } from "vitest";
import { mergeMedia } from "@/lib/services/operators/media-merge";
import type { PreparedOperator } from "@/lib/services/operators/prepared-pages";

const op: PreparedOperator = {
  slug: "reef-co", name: "Reef Co", website: "https://reef.test", summary: "x", heroImage: "https://reef.test/old-hero.jpg",
  trips: [
    { title: "Outer reef day", kind: "snorkel", summary: "x", sourceUrl: "https://reef.test/day", images: ["https://reef.test/a.jpg"] },
    { title: "Sunset sail", kind: "sail", summary: "x", sourceUrl: "https://reef.test/sunset" },
  ],
};

describe("mergeMedia", () => {
  it("lays the operator's media into the page, adding to what each trip had", () => {
    const merged = mergeMedia(op, {
      slug: "reef-co",
      logo: "https://reef.test/logo.svg",
      heroImage: "https://reef.test/new-hero.jpg",
      gallery: ["https://reef.test/g1.jpg", "https://reef.test/g1.jpg"],
      videos: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "On the reef" }],
      trips: [{ title: "Outer reef day ", images: ["https://reef.test/a.jpg", "https://reef.test/b.jpg"] }, { title: "Not on the page", images: ["https://reef.test/x.jpg"] }],
    });
    expect(merged.logo).toBe("https://reef.test/logo.svg");
    expect(merged.heroImage).toBe("https://reef.test/new-hero.jpg");
    expect(merged.gallery).toEqual(["https://reef.test/g1.jpg"]);
    expect(merged.videos).toHaveLength(1);
    expect(merged.trips[0].images).toEqual(["https://reef.test/a.jpg", "https://reef.test/b.jpg"]);
    expect(merged.trips[1].images).toBeUndefined();
  });

  it("ignores a media file for another operator", () => {
    expect(mergeMedia(op, { slug: "other-co", logo: "https://other.test/logo.png" })).toBe(op);
  });
});
