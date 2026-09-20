-- Agent learning: durable, reviewable lessons derived from run outcomes.

CREATE TYPE "AgentLessonStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'REJECTED', 'RETIRED');

CREATE TABLE "AgentLesson" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "evidence" JSONB,
    "status" "AgentLessonStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedByRunId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "retiredReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentLesson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentLesson_agentId_status_idx" ON "AgentLesson"("agentId", "status");
CREATE INDEX "AgentLesson_status_createdAt_idx" ON "AgentLesson"("status", "createdAt");
