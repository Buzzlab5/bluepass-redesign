-- Rezdy and FareHarbor as channels for the booking CMS.
--
-- A trip now says where its seats live: Bluepass's own rails, the operator's Rezdy
-- (booked through Bluepass's agent account) or the operator's FareHarbor (booked in
-- FareHarbor's checkout under Bluepass's affiliate tag). Bookings remember the order
-- number in the operator's system and the commission it reports. Operators connect
-- their account once; FareHarbor hand-offs carry a reference that matches the
-- affiliate report back to the trip.

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('WAITING', 'CONNECTED', 'BROKEN');

-- AlterEnum
ALTER TYPE "ListingBookingStatus" ADD VALUE 'REQUESTED';

-- AlterEnum
ALTER TYPE "ListingPaymentStatus" ADD VALUE 'PAID_VIA_CHANNEL';

-- AlterTable
ALTER TABLE "ListingBooking" ADD COLUMN     "answers" JSONB,
ADD COLUMN     "channel" "PmsPlatform" NOT NULL DEFAULT 'NATIVE',
ADD COLUMN     "commissionCents" INTEGER,
ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "externalStatus" TEXT,
ADD COLUMN     "externalSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OperatorListing" ADD COLUMN     "channel" "PmsPlatform" NOT NULL DEFAULT 'NATIVE',
ADD COLUMN     "channelData" JSONB,
ADD COLUMN     "channelIssue" TEXT,
ADD COLUMN     "channelSyncedAt" TIMESTAMP(3),
ADD COLUMN     "externalBookingUrl" TEXT;

-- CreateTable
CREATE TABLE "OperatorChannelConnection" (
    "id" TEXT NOT NULL,
    "operatorProfileId" TEXT NOT NULL,
    "platform" "PmsPlatform" NOT NULL,
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'WAITING',
    "accountKey" TEXT NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT,
    "timezone" TEXT,
    "currency" TEXT,
    "autoPublish" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelHandoff" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "operatorProfileId" TEXT NOT NULL,
    "channel" "PmsPlatform" NOT NULL,
    "referralCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelCursor" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelCursor_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "OperatorChannelConnection_status_idx" ON "OperatorChannelConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorChannelConnection_platform_accountKey_key" ON "OperatorChannelConnection"("platform", "accountKey");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorChannelConnection_operatorProfileId_platform_key" ON "OperatorChannelConnection"("operatorProfileId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelHandoff_reference_key" ON "ChannelHandoff"("reference");

-- CreateIndex
CREATE INDEX "ChannelHandoff_listingId_createdAt_idx" ON "ChannelHandoff"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelHandoff_operatorProfileId_createdAt_idx" ON "ChannelHandoff"("operatorProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingBooking_externalReference_key" ON "ListingBooking"("externalReference");

-- CreateIndex
CREATE INDEX "OperatorListing_channel_externalProductId_idx" ON "OperatorListing"("channel", "externalProductId");

-- AddForeignKey
ALTER TABLE "OperatorChannelConnection" ADD CONSTRAINT "OperatorChannelConnection_operatorProfileId_fkey" FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelHandoff" ADD CONSTRAINT "ChannelHandoff_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelHandoff" ADD CONSTRAINT "ChannelHandoff_operatorProfileId_fkey" FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Listings the Rezdy discover sync created already carry a Rezdy product code. They are
-- Rezdy trips; marking them so is what makes them bookable through the agent API.
UPDATE "OperatorListing" SET "channel" = 'REZDY' WHERE "externalProductId" IS NOT NULL AND "channel" = 'NATIVE';
