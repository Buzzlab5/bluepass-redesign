-- Booking CMS: the write side of the native rails.
--
-- Turns a listing's recurring schedule into seats a traveller can pay for and a
-- manifest an operator can work from. Bookings are financial records, so their
-- links to the listing and the operator RESTRICT deletes rather than cascading.
--
-- ListingDepartureOverride only holds exceptions (a closed or resized departure);
-- a listing that runs exactly to its rule has no rows in it.
-- CreateEnum
CREATE TYPE "ListingBookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ListingBookingSource" AS ENUM ('ONLINE', 'KAI', 'OPERATOR');

-- CreateEnum
CREATE TYPE "ListingPaymentStatus" AS ENUM ('UNPAID', 'PAID', 'PAID_TO_OPERATOR', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- AlterTable
ALTER TABLE "OperatorListing" ADD COLUMN     "confirmationNote" TEXT,
ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "meetingPoint" TEXT;

-- CreateTable
CREATE TABLE "ListingDepartureOverride" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "departsAt" TIMESTAMP(3) NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingDepartureOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingBooking" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "operatorProfileId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "departsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "guests" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "conservationCents" INTEGER NOT NULL DEFAULT 0,
    "operatorNetCents" INTEGER NOT NULL DEFAULT 0,
    "status" "ListingBookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "source" "ListingBookingSource" NOT NULL,
    "paymentStatus" "ListingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "leadName" TEXT NOT NULL,
    "leadEmail" TEXT,
    "leadPhone" TEXT,
    "notes" TEXT,
    "referralCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "stripeTransferId" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingBookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingBookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingDepartureOverride_listingId_departsAt_key" ON "ListingDepartureOverride"("listingId", "departsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingBooking_reference_key" ON "ListingBooking"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ListingBooking_stripeCheckoutSessionId_key" ON "ListingBooking"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "ListingBooking_listingId_departsAt_idx" ON "ListingBooking"("listingId", "departsAt");

-- CreateIndex
CREATE INDEX "ListingBooking_operatorProfileId_departsAt_idx" ON "ListingBooking"("operatorProfileId", "departsAt");

-- CreateIndex
CREATE INDEX "ListingBooking_status_expiresAt_idx" ON "ListingBooking"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ListingBooking_leadEmail_idx" ON "ListingBooking"("leadEmail");

-- CreateIndex
CREATE INDEX "ListingBookingEvent_bookingId_createdAt_idx" ON "ListingBookingEvent"("bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "ListingDepartureOverride" ADD CONSTRAINT "ListingDepartureOverride_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingBooking" ADD CONSTRAINT "ListingBooking_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "OperatorListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingBooking" ADD CONSTRAINT "ListingBooking_operatorProfileId_fkey" FOREIGN KEY ("operatorProfileId") REFERENCES "OperatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingBookingEvent" ADD CONSTRAINT "ListingBookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ListingBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

