ALTER TYPE "ProcessingStatus" ADD VALUE 'DEAD_LETTER';

ALTER TABLE "ProcessingJob"
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "queueJobId" TEXT,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "ProcessingJob_leaseExpiresAt_idx" ON "ProcessingJob"("leaseExpiresAt");
