CREATE TYPE "ReminderStatus" AS ENUM ('OPEN', 'SNOOZED', 'DONE');
CREATE TYPE "NotificationKind" AS ENUM ('ATTENTION', 'FOLLOW_UP', 'DRAFT_READY', 'SYSTEM');

CREATE TABLE "IdentityProfile" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "label" TEXT NOT NULL,
  "displayName" TEXT NOT NULL, "email" TEXT NOT NULL, "role" TEXT,
  "company" TEXT, "phone" TEXT, "website" TEXT, "pronouns" TEXT,
  "signature" TEXT NOT NULL, "closing" TEXT NOT NULL, "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "IdentityProfile_userId_label_key" ON "IdentityProfile"("userId", "label");
CREATE INDEX "IdentityProfile_userId_isDefault_idx" ON "IdentityProfile"("userId", "isDefault");

CREATE TABLE "FollowUpReminder" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "threadId" TEXT, "title" TEXT NOT NULL,
  "note" TEXT, "dueAt" TIMESTAMP(3) NOT NULL, "status" "ReminderStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "FollowUpReminder_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE
);
CREATE INDEX "FollowUpReminder_userId_status_dueAt_idx" ON "FollowUpReminder"("userId", "status", "dueAt");

CREATE TABLE "Notification" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "threadId" TEXT, "kind" "NotificationKind" NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Notification_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

CREATE TABLE "PushSubscription" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL, "userAgent" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
