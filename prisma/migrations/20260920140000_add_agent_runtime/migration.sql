-- Agent runtime: durable job queue, run log, and the human decision queue.

CREATE TYPE "AgentJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');
CREATE TYPE "AgentDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "payload" JSONB,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "jobId" TEXT,
    "triggerKey" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" JSONB,
    "outcome" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB,
    "options" JSONB,
    "defaultAction" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "status" "AgentDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "onResolve" JSONB,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentJob_agentId_triggerKey_key" ON "AgentJob"("agentId", "triggerKey");
CREATE INDEX "AgentJob_status_runAfter_idx" ON "AgentJob"("status", "runAfter");
CREATE INDEX "AgentJob_agentId_createdAt_idx" ON "AgentJob"("agentId", "createdAt");
CREATE INDEX "AgentRun_agentId_startedAt_idx" ON "AgentRun"("agentId", "startedAt");
CREATE INDEX "AgentRun_status_startedAt_idx" ON "AgentRun"("status", "startedAt");
CREATE INDEX "AgentDecision_status_expiresAt_idx" ON "AgentDecision"("status", "expiresAt");
CREATE INDEX "AgentDecision_entityType_entityId_idx" ON "AgentDecision"("entityType", "entityId");
CREATE INDEX "AgentDecision_agentId_createdAt_idx" ON "AgentDecision"("agentId", "createdAt");
