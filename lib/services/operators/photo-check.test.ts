import { describe, expect, it } from "vitest";
import { applyPhotoChecks, photoProblem, photoScore, photosOf, type PhotoFinding, type PhotoMeasure } from "@/lib/services/operators/photo-check";
import type { PreparedOperator } from "@/lib/services/operators/prepared-pages";

const photo: PhotoMeasure = { width: 1920, height: 1080, spread: 52 };

describe("photoProblem", () => {
  it("passes an ordinary trip photo", () => {
    expect(photoProblem("https://x.test/reef.jpg", photo, "trip")).toBeNull();
  });

  it("leaves out what would look broken on a card", () => {
    expect(photoProblem("https://x.test/a.jpg", "missing", "trip")).toBe("would not load");
    expect(photoProblem("https://x.test/boat.jpg", { width: 291, height: 441, spread: 50 }, "trip")).toMatch(/too small/);
    // Measured from a real site: a blue horizon used as a section background.
    expect(photoProblem("https://x.test/bg.jpg", { width: 4320, height: 1020, spread: 7.2 }, "trip")).toMatch(/plain colour/);
    expect(photoProblem("https://x.test/strip.jpg", { width: 3000, height: 900, spread: 40 }, "trip")).toMatch(/banner/);
    expect(photoProblem("https://x.test/Screenshot-2025-10-07-at-2.46.04-pm.png", { width: 1129, height: 1263, spread: 51 }, "trip")).toBe("a screenshot");
  });

  it("keeps a photo the site would not let the checker fetch, for a person to judge", () => {
    expect(photoProblem("https://x.test/a.jpg", "blocked", "trip")).toBeNull();
  });

  it("lets the page hero be wider than a trip photo", () => {
    const wide = { width: 3840, height: 1360, spread: 17.6 };
    expect(photoProblem("https://x.test/hero.jpg", wide, "hero")).toBeNull();
    expect(photoProblem("https://x.test/hero.jpg", wide, "trip")).toMatch(/banner/);
  });
});

describe("applyPhotoChecks", () => {
  const op: PreparedOperator = {
    slug: "reef-co", name: "Reef Co", website: "https://reef.test", summary: "Small reef trips.",
    heroImage: "https://reef.test/bg.jpg",
    trips: [
      { title: "Day trip", kind: "tour", summary: "A day on the reef.", sourceUrl: "https://reef.test/day", images: ["https://reef.test/bg.jpg", "https://reef.test/turtle.jpg", "https://reef.test/turtle.jpg"] },
      { title: "Charter", kind: "charter", summary: "The boat to yourselves.", sourceUrl: "https://reef.test/charter", images: ["https://reef.test/gone.jpg", "https://reef.test/guarded.jpg"] },
    ],
  };
  const measured = new Map<string, PhotoFinding>([
    ["https://reef.test/bg.jpg", { width: 4320, height: 1020, spread: 7 }],
    ["https://reef.test/turtle.jpg", photo],
    ["https://reef.test/gone.jpg", "missing"],
    ["https://reef.test/guarded.jpg", "blocked"],
  ]);

  it("keeps good photos once, records the rest, and swaps a failed hero for a trip photo", () => {
    const checked = applyPhotoChecks(op, measured);
    expect(checked.trips[0].images).toEqual(["https://reef.test/turtle.jpg"]);
    expect(checked.trips[0].photosLeftOut).toEqual([{ url: "https://reef.test/bg.jpg", reason: expect.stringMatching(/plain colour/) }]);
    expect(checked.trips[1].images).toEqual(["https://reef.test/guarded.jpg"]);
    expect(checked.trips[1].photosLeftOut).toEqual([{ url: "https://reef.test/gone.jpg", reason: "would not load" }]);
    expect(checked.trips[1].photosUnmeasured).toEqual(["https://reef.test/guarded.jpg"]);
    expect(checked.heroImage).toBe("https://reef.test/turtle.jpg");
    expect(checked.photosLeftOut?.[0].url).toBe("https://reef.test/bg.jpg");
  });

  it("lists every photo a page uses once", () => {
    expect(photosOf(op)).toEqual(["https://reef.test/bg.jpg", "https://reef.test/turtle.jpg", "https://reef.test/gone.jpg", "https://reef.test/guarded.jpg"]);
  });
});

describe("leading with the best photo", () => {
  it("puts big, landscape, detailed photos first and unmeasured ones last", () => {
    const op: PreparedOperator = {
      slug: "reef-co", name: "Reef Co", website: "https://reef.test", summary: "x",
      trips: [{ title: "Day", kind: "tour", summary: "x", sourceUrl: "https://reef.test", images: ["https://reef.test/guarded.jpg", "https://reef.test/small.jpg", "https://reef.test/portrait.jpg", "https://reef.test/big.jpg"] }],
    };
    const measured = new Map<string, PhotoFinding>([
      ["https://reef.test/guarded.jpg", "blocked"],
      ["https://reef.test/small.jpg", { width: 800, height: 600, spread: 50 }],
      ["https://reef.test/portrait.jpg", { width: 1600, height: 2000, spread: 50 }],
      ["https://reef.test/big.jpg", { width: 2400, height: 1600, spread: 45 }],
    ]);
    expect(applyPhotoChecks(op, measured).trips[0].images).toEqual([
      "https://reef.test/big.jpg", "https://reef.test/portrait.jpg", "https://reef.test/small.jpg", "https://reef.test/guarded.jpg",
    ]);
    expect(photoScore("blocked")).toBe(0);
  });
});
