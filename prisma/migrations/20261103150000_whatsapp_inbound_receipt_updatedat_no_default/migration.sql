-- AlterTable
-- updatedAt is maintained by Prisma (@updatedAt); a DB default was never in the schema.
ALTER TABLE "WhatsAppInboundReceipt" ALTER COLUMN "updatedAt" DROP DEFAULT;
