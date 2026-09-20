-- Manager layer: standing directives and generated reports.

CREATE TYPE "AgentDirectiveStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

CREATE TABLE "AgentDirective" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "levers" JSONB NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "status" "AgentDirectiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentDirective_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagerReport" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "reportsTo" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "headline" TEXT NOT NULL,
    "concerns" JSONB,
    "citations" JSONB,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagerReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentDirective_scopeType_scopeId_status_idx" ON "AgentDirective"("scopeType", "scopeId", "status");
CREATE INDEX "AgentDirective_status_expiresAt_idx" ON "AgentDirective"("status", "expiresAt");
CREATE INDEX "ManagerReport_managerId_createdAt_idx" ON "ManagerReport"("managerId", "createdAt");
CREATE INDEX "ManagerReport_reportsTo_createdAt_idx" ON "ManagerReport"("reportsTo", "createdAt");
