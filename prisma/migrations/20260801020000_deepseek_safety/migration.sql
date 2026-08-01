-- DeepSeek analysis, reply generations, and review audit history.
ALTER TYPE "AuditAction" ADD VALUE 'REPLY_EDITED';
ALTER TYPE "AuditAction" ADD VALUE 'REPLY_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'REPLY_APPROVED';

CREATE TABLE "ThreadAnalysis" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "analysis" JSONB NOT NULL,
  "safetyFlags" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThreadAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReplyGeneration" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "length" TEXT NOT NULL,
  "identity" TEXT NOT NULL,
  "closing" TEXT NOT NULL,
  "requiredReviewFlags" TEXT[] NOT NULL,
  "acknowledgedFlags" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReplyGeneration_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReplyOption" ADD COLUMN "generationId" TEXT;
ALTER TABLE "ReplyOption" ADD COLUMN "intent" TEXT;
ALTER TABLE "ReplyOption" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "ReplyOption_threadId_rank_key";
CREATE UNIQUE INDEX "ReplyOption_generationId_rank_key" ON "ReplyOption"("generationId", "rank");
CREATE INDEX "ReplyOption_generationId_idx" ON "ReplyOption"("generationId");
CREATE INDEX "ThreadAnalysis_threadId_createdAt_idx" ON "ThreadAnalysis"("threadId", "createdAt");
CREATE INDEX "ReplyGeneration_threadId_createdAt_idx" ON "ReplyGeneration"("threadId", "createdAt");

ALTER TABLE "ThreadAnalysis" ADD CONSTRAINT "ThreadAnalysis_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplyGeneration" ADD CONSTRAINT "ReplyGeneration_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReplyOption" ADD CONSTRAINT "ReplyOption_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "ReplyGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
