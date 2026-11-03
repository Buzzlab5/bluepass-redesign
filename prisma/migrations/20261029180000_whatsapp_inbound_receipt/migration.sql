-- CreateTable
CREATE TABLE "WhatsAppInboundReceipt" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "fromPhone" TEXT,
    "handler" TEXT NOT NULL,
    "outcome" TEXT,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppInboundReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInboundReceipt_providerMessageId_key" ON "WhatsAppInboundReceipt"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppInboundReceipt_outcome_updatedAt_idx" ON "WhatsAppInboundReceipt"("outcome", "updatedAt");
