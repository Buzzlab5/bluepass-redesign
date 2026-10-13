-- Corrections made while checking a prepared page, kept apart from what was read off the
-- operator's website so that importing the page again cannot undo them.

-- AlterTable
ALTER TABLE "PreparedOperatorPage" ADD COLUMN "edits" JSONB,
ADD COLUMN "editedBy" TEXT,
ADD COLUMN "editedAt" TIMESTAMP(3);
