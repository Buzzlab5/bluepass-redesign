-- Calendar and WhatsApp for the booking CMS.
--
-- Google Calendar: an operator connection (refresh token encrypted at rest), one mirrored
-- event per booked departure, and busy blocks read through FreeBusy (times only, never
-- titles) that close departures. WhatsApp and email: one row per message with its
-- delivery status, each made once-only by a dedupe key.

-- CreateEnum
CREATE TYPE "GoogleConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT');

-- CreateEnum
CREATE TYPE "RailsNotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "RailsNotificationAudience" AS ENUM ('TRAVELLER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "RailsNotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "ListingBooking" ADD COLUMN     "guestToken" TEXT,
ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OperatorListing" ADD COLUMN     "busyCalendarId" TEXT;

-- CreateTable
CREATE TABLE "OperatorGoogleConnection" (
    "id" TEXT NOT NULL,
    "operatorProfileId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "scopes" TEXT[],
    "bookingsCalendarId" TEXT,
    "status" "GoogleConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorGoogleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartureCalendarEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "departsAt" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT,
    "dirtyAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartureCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorBusyBlock" (
    "id" TEXT NOT NULL,
    "operatorProfileId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorBusyBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorRailsSettings" (
    "id" TEXT NOT NULL,
    "operatorProfileId" TEXT NOT NULL,
    "whatsappNewBooking" BOOLEAN NOT NULL DEFAULT true,
    "whatsappDailyDigest" BOOLEAN NOT NULL DEFAULT true,
    "emailNewBooking" BOOLEAN NOT NULL DEFAULT true,
    "digestHour" INTEGER NOT NULL DEFAULT 17,
    "calendarFeedToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorRailsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RailsNotification" (
    "id" TEXT NOT NULL,
    "operatorProfileId" TEXT NOT NULL,
    "bookingId" TEXT,
    "channel" "RailsNotificationChannel" NOT NULL,
    "audience" "RailsNotificationAudience" NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "RailsNotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT,
    "providerMessageId" TEXT,
    "detail" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RailsNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperatorGoogleConnection_operatorProfileId_key" ON "OperatorGoogleConnection"("operatorProfileId");

-- CreateIndex
CREATE INDEX "DepartureCalendarEvent_dirtyAt_idx" ON "DepartureCalendarEvent"("dirtyAt");

-- CreateIndex
CREATE UNIQUE INDEX "DepartureCalendarEvent_listingId_departsAt_key" ON "DepartureCalendarEvent"("listingId", "departsAt");

-- CreateIndex
CREATE INDEX "OperatorBusyBlock_calendarId_startsAt_idx" ON "OperatorBusyBlock"("calendarId", "startsAt");

-- CreateIndex
CREATE INDEX "OperatorBusyBlock_operatorProfileId_idx" ON "OperatorBusyBlock"("operatorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorRailsSettings_operatorProfileId_key" ON "OperatorRailsSettings"("operatorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorRailsSettings_calendarFeedToken_key" ON "OperatorRailsSettings"("calendarFeedToken");

-- CreateIndex
CREATE UNIQUE INDEX "RailsNotification_dedupeKey_key" ON "RailsNotification"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "RailsNotification_providerMessageId_key" ON "RailsNotification"("providerMessageId");

-- CreateIndex
CREATE INDEX "RailsNotification_bookingId_createdAt_idx" ON "RailsNotification"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "RailsNotification_operatorProfileId_createdAt_idx" ON "RailsNotification"("operatorProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingBooking_guestToken_key" ON "ListingBooking"("guestToken");

-- AddForeignKey
ALTER TABLE "OperatorGoogleConnection" ADD CONSTRAINT "OperatorGoogleConnection_operatorProfileId_fkey" FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartureCalendarEvent" ADD CONSTRAINT "DepartureCalendarEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorRailsSettings" ADD CONSTRAINT "OperatorRailsSettings_operatorProfileId_fkey" FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RailsNotification" ADD CONSTRAINT "RailsNotification_operatorProfileId_fkey" FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RailsNotification" ADD CONSTRAINT "RailsNotification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ListingBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

