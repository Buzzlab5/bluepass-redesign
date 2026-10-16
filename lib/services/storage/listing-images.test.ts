import { describe, expect, it } from "vitest";
import { isListingImageUrl, listingImageProblem } from "@/lib/services/storage/listing-images";

describe("listingImageProblem", () => {
  it("accepts a normal photo", () => {
    expect(listingImageProblem({ type: "image/jpeg", size: 480_000 })).toBeNull();
    expect(listingImageProblem({ type: "image/webp", size: 500 })).toBeNull();
  });

  it("refuses anything that is not a browser-safe photo", () => {
    expect(listingImageProblem({ type: "image/svg+xml", size: 1000 })).toMatch(/JPG, PNG, WebP or AVIF/);
    expect(listingImageProblem({ type: "application/pdf", size: 1000 })).toMatch(/JPG, PNG, WebP or AVIF/);
    expect(listingImageProblem({ type: "image/gif", size: 1000 })).toMatch(/JPG, PNG, WebP or AVIF/);
  });

  it("refuses an empty or oversized file with a plain reason", () => {
    expect(listingImageProblem({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(listingImageProblem({ type: "image/png", size: 2 * 1024 * 1024 })).toMatch(/too large/);
  });
});

describe("isListingImageUrl", () => {
  const ours = "https://abcd1234.supabase.co/storage/v1/object/public/operator-listings/acct/photo.jpg";

  it("accepts a photo in our own public bucket", () => {
    expect(isListingImageUrl(ours)).toBe(true);
  });

  it("refuses any other address", () => {
    expect(isListingImageUrl("https://evil.example.com/storage/v1/object/public/operator-listings/a.jpg")).toBe(false);
    expect(isListingImageUrl("https://abcd1234.supabase.co/storage/v1/object/public/blog-images/a.jpg")).toBe(false);
    expect(isListingImageUrl("http://abcd1234.supabase.co/storage/v1/object/public/operator-listings/a.jpg")).toBe(false);
    expect(isListingImageUrl("javascript:alert(1)")).toBe(false);
    expect(isListingImageUrl("not a url")).toBe(false);
  });
});
