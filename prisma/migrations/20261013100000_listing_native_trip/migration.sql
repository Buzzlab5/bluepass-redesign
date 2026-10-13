-- The Kai native trip a listing was written from. Additive and nullable: existing listings are untouched.
ALTER TABLE "OperatorListing" ADD COLUMN "nativeTripId" TEXT;

CREATE UNIQUE INDEX "OperatorListing_nativeTripId_key" ON "OperatorListing"("nativeTripId");
