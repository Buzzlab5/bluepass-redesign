-- The photos an operator adds to a trip's gallery. Additive: every existing listing gets an empty list.
ALTER TABLE "OperatorListing" ADD COLUMN "galleryUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
