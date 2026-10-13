-- Operator pages Bluepass prepares from an operator's own published information,
-- held back until a person has checked them against the source.

-- CreateTable
CREATE TABLE "PreparedOperatorPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "qcStatus" TEXT NOT NULL DEFAULT 'pending',
    "qcNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreparedOperatorPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreparedOperatorPage_slug_key" ON "PreparedOperatorPage"("slug");
