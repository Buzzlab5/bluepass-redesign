import { describe, expect, it } from "vitest";
import { applyPhotoChecks, bestCopies, photoProblem, photoScore, photosOf, samePhoto, type PhotoFinding, type PhotoMeasure } from "@/lib/services/operators/photo-check";
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

  it("leaves out a photo too heavy to load quickly on a phone", () => {
    expect(photoProblem("https://x.test/original.jpg", { width: 6000, height: 4000, spread: 50, bytes: 14 * 1024 * 1024 }, "trip")).toMatch(/too heavy/);
    expect(photoProblem("https://x.test/web.jpg", { width: 1600, height: 1067, spread: 50, bytes: 420 * 1024 }, "trip")).toBeNull();
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

describe("one photo at several addresses", () => {
  it("treats fingerprints a few points apart as the same photo", () => {
    expect(samePhoto("f0f0f0f0f0f0f0f0", "f0f0f0f0f0f0f0f0")).toBe(true);
    expect(samePhoto("f0f0f0f0f0f0f0f0", "f0f0f0f0f0f0f0f3")).toBe(true);
    expect(samePhoto("f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f")).toBe(false);
    expect(samePhoto(undefined, "f0f0f0f0f0f0f0f0")).toBe(false);
  });

  it("swaps every copy for the biggest one that passes, and shows it once", () => {
    const measured = new Map<string, PhotoFinding>([
      ["https://reef.test/shark-1024x683.jpg", { width: 1024, height: 683, spread: 50, print: "a1b2c3d4e5f60718" }],
      ["https://reef.test/shark.jpg", { width: 2400, height: 1600, spread: 50, print: "a1b2c3d4e5f60719" }],
      // The original upload is too heavy to send to a phone, so a passing copy wins.
      ["https://reef.test/shark-original.jpg", { width: 6000, height: 4000, spread: 50, bytes: 14 * 1024 * 1024, print: "a1b2c3d4e5f60718" }],
      ["https://reef.test/turtle.jpg", { width: 1600, height: 1067, spread: 48, print: "0f1e2d3c4b5a6978" }],
    ]);
    expect(bestCopies([...measured.keys()], measured).get("https://reef.test/shark-1024x683.jpg")).toBe("https://reef.test/shark.jpg");
    const op: PreparedOperator = {
      slug: "reef-co", name: "Reef Co", website: "https://reef.test", summary: "Small reef trips.",
      heroImage: "https://reef.test/shark-1024x683.jpg",
      gallery: ["https://reef.test/shark-1024x683.jpg", "https://reef.test/turtle.jpg", "https://reef.test/shark-original.jpg"],
      trips: [
        { title: "Shark dive", sourceUrl: "https://reef.test/sharks", summary: "Sharks.", images: ["https://reef.test/shark-1024x683.jpg", "https://reef.test/shark.jpg"] },
      ],
    } as PreparedOperator;
    const checked = applyPhotoChecks(op, measured);
    expect(checked.heroImage).toBe("https://reef.test/shark.jpg");
    expect(checked.gallery).toEqual(["https://reef.test/shark.jpg", "https://reef.test/turtle.jpg"]);
    expect(checked.trips[0].images).toEqual(["https://reef.test/shark.jpg"]);
  });
});

describe("quick to load", () => {
  it("puts a light photo before a heavy original of the same size", () => {
    const light = photoScore({ width: 2560, height: 1700, spread: 50, bytes: 360 * 1024 });
    const heavy = photoScore({ width: 8192, height: 5464, spread: 50, bytes: 3.5 * 1024 * 1024 });
    expect(light).toBeGreaterThan(heavy);
    expect(heavy).toBeGreaterThan(0);
  });
});
