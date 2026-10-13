-- Photos on a prepared page are linked from the operator's own website and shown to
-- travellers only once the operator has approved them, after their claim is approved.

-- AlterTable
ALTER TABLE "PreparedOperatorPage" ADD COLUMN "photosApproved" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "photosApprovedAt" TIMESTAMP(3),
ADD COLUMN "photosApprovedBy" TEXT,
ADD COLUMN "photosSeen" TEXT[] DEFAULT ARRAY[]::TEXT[];
