-- CreateEnum
CREATE TYPE "OutreachAudience" AS ENUM ('OPERATOR', 'CREATOR');

-- CreateEnum
CREATE TYPE "OutreachEnrolmentStatus" AS ENUM ('ENROLLED', 'REPLIED', 'INTERESTED', 'NOT_INTERESTED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED', 'COMPLETED');

-- CreateTable
CREATE TABLE "OutreachEnrolment" (
    "id" TEXT NOT NULL,
    "audience" "OutreachAudience" NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "operatorLeadId" TEXT,
    "creatorId" TEXT,
    "status" "OutreachEnrolmentStatus" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "consentBasis" TEXT NOT NULL,
    "instantlyLeadId" TEXT,
    "stopReason" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT,
    "enrolmentId" TEXT,
    "campaignId" TEXT,
    "payload" JSONB NOT NULL,
    "needsPerson" BOOLEAN NOT NULL DEFAULT false,
    "handledAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachEnrolment_operatorLeadId_idx" ON "OutreachEnrolment"("operatorLeadId");

-- CreateIndex
CREATE INDEX "OutreachEnrolment_creatorId_idx" ON "OutreachEnrolment"("creatorId");

-- CreateIndex
CREATE INDEX "OutreachEnrolment_status_idx" ON "OutreachEnrolment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachEnrolment_email_campaignKey_key" ON "OutreachEnrolment"("email", "campaignKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachSuppression_email_key" ON "OutreachSuppression"("email");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachEvent_dedupeKey_key" ON "OutreachEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutreachEvent_enrolmentId_idx" ON "OutreachEvent"("enrolmentId");

-- CreateIndex
CREATE INDEX "OutreachEvent_type_idx" ON "OutreachEvent"("type");

-- CreateIndex
CREATE INDEX "OutreachEvent_needsPerson_handledAt_idx" ON "OutreachEvent"("needsPerson", "handledAt");

-- AddForeignKey
ALTER TABLE "OutreachEnrolment" ADD CONSTRAINT "OutreachEnrolment_operatorLeadId_fkey" FOREIGN KEY ("operatorLeadId") REFERENCES "OperatorLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEnrolment" ADD CONSTRAINT "OutreachEnrolment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "OutreachEnrolment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

