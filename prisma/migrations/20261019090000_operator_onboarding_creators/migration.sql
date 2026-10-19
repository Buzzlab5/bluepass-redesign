-- Operator onboarding: creators operators can pick, their picks, and the creator credit ledger.
CREATE TYPE "CreatorCampaignStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'DECLINED', 'FEATURED', 'DISPUTED', 'CANCELLED');
CREATE TYPE "OperatorCreditKind" AS ENUM ('WELCOME_GRANT', 'CAMPAIGN_HOLD', 'CAMPAIGN_RELEASE');

CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "youtube" TEXT,
    "tiktok" TEXT,
    "contactEmail" TEXT,
    "baseState" TEXT,
    "baseTown" TEXT,
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "sourceUrl" TEXT,
    "source" TEXT NOT NULL,
    "partnerProfileId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "invitedBy" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Creator_slug_key" ON "Creator"("slug");
CREATE UNIQUE INDEX "Creator_partnerProfileId_key" ON "Creator"("partnerProfileId");
CREATE INDEX "Creator_baseState_idx" ON "Creator"("baseState");
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_partnerProfileId_fkey" FOREIGN KEY ("partnerProfileId") REFERENCES "PartnerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CreatorCampaign" (
    "id" TEXT NOT NULL,
    "operatorAccountId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "operatorPath" TEXT,
    "creatorId" TEXT NOT NULL,
    "status" "CreatorCampaignStatus" NOT NULL DEFAULT 'REQUESTED',
    "creditCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "referralLinkId" TEXT,
    "postUrl" TEXT,
    "respondedAt" TIMESTAMP(3),
    "featuredAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreatorCampaign_referralLinkId_key" ON "CreatorCampaign"("referralLinkId");
CREATE UNIQUE INDEX "CreatorCampaign_operatorAccountId_creatorId_key" ON "CreatorCampaign"("operatorAccountId", "creatorId");
CREATE INDEX "CreatorCampaign_creatorId_idx" ON "CreatorCampaign"("creatorId");
CREATE INDEX "CreatorCampaign_status_idx" ON "CreatorCampaign"("status");
ALTER TABLE "CreatorCampaign" ADD CONSTRAINT "CreatorCampaign_operatorAccountId_fkey" FOREIGN KEY ("operatorAccountId") REFERENCES "BluePassAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorCampaign" ADD CONSTRAINT "CreatorCampaign_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OperatorCreditEntry" (
    "id" TEXT NOT NULL,
    "operatorAccountId" TEXT NOT NULL,
    "kind" "OperatorCreditKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "campaignId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "onceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperatorCreditEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperatorCreditEntry_onceKey_key" ON "OperatorCreditEntry"("onceKey");
CREATE INDEX "OperatorCreditEntry_operatorAccountId_idx" ON "OperatorCreditEntry"("operatorAccountId");
ALTER TABLE "OperatorCreditEntry" ADD CONSTRAINT "OperatorCreditEntry_operatorAccountId_fkey" FOREIGN KEY ("operatorAccountId") REFERENCES "BluePassAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
