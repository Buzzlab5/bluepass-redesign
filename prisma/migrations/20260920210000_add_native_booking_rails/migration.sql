-- Native booking rails: inventory for operators who have no booking system.
--
-- Availability is stored as a recurring RULE per listing, not a row per day.
-- Operators without a booking system will not maintain a calendar, so anything
-- needing weekly upkeep gets abandoned. Departures are derived at query time.
--
-- Seats sold are tracked against a specific departure instant, so a listing
-- costs nothing to carry until somebody books it.

CREATE TABLE "ListingSchedule" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "label" TEXT,
    "weekdays" INTEGER[],
    "departureTimes" TEXT[],
    "seasonStart" TIMESTAMP(3),
    "seasonEnd" TIMESTAMP(3),
    "capacityPerDeparture" INTEGER NOT NULL,
    "minGuests" INTEGER NOT NULL DEFAULT 1,
    "cutoffHours" INTEGER NOT NULL DEFAULT 24,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 365,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Brisbane',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListingSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingBlackout" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListingBlackout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingRate" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "perGuest" BOOLEAN NOT NULL DEFAULT true,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "seasonStart" TIMESTAMP(3),
    "seasonEnd" TIMESTAMP(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListingRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingSeatHold" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "departsAt" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "bookingId" TEXT,
    "inquiryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListingSeatHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListingSchedule_listingId_active_idx" ON "ListingSchedule"("listingId", "active");
CREATE INDEX "ListingBlackout_listingId_startDate_endDate_idx" ON "ListingBlackout"("listingId", "startDate", "endDate");
CREATE INDEX "ListingRate_listingId_active_idx" ON "ListingRate"("listingId", "active");
-- The hot path: every availability query reads seats for one listing on one departure.
CREATE INDEX "ListingSeatHold_listingId_departsAt_idx" ON "ListingSeatHold"("listingId", "departsAt");
CREATE INDEX "ListingSeatHold_expiresAt_idx" ON "ListingSeatHold"("expiresAt");

ALTER TABLE "ListingSchedule" ADD CONSTRAINT "ListingSchedule_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingBlackout" ADD CONSTRAINT "ListingBlackout_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingRate" ADD CONSTRAINT "ListingRate_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingSeatHold" ADD CONSTRAINT "ListingSeatHold_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
