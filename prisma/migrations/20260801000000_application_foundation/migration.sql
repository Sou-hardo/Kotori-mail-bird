-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'RUNNING', 'FAILED');

-- CreateEnum
CREATE TYPE "ThreadCategory" AS ENUM ('ACTION_REQUIRED', 'WAITING', 'FYI', 'NEWSLETTER', 'RECEIPT', 'SPAM', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'CREATED_IN_GMAIL', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CONNECTION_CREATED', 'CONNECTION_REVOKED', 'SYNC_STARTED', 'SYNC_COMPLETED', 'CLASSIFICATION_CREATED', 'REPLY_GENERATED', 'GMAIL_DRAFT_CREATED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "gmailConnectionId" TEXT NOT NULL,
    "historyId" TEXT,
    "pageToken" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailThread" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gmailConnectionId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "subject" TEXT,
    "snippet" TEXT,
    "latestMessageAt" TIMESTAMP(3) NOT NULL,
    "isUnread" BOOLEAN NOT NULL DEFAULT false,
    "labelIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "internetMessageId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddresses" TEXT[],
    "ccAddresses" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL,
    "snippet" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "headers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "gmailAttachmentId" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentId" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classification" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "category" "ThreadCategory" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadSummary" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "requestedActions" TEXT[],
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyOption" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplyOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailDraft" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "replyOptionId" TEXT,
    "gmailDraftId" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'SUGGESTED',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "GmailConnection_tenantId_status_idx" ON "GmailConnection"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_tenantId_googleAccountId_key" ON "GmailConnection"("tenantId", "googleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_tenantId_emailAddress_key" ON "GmailConnection"("tenantId", "emailAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_gmailConnectionId_key" ON "SyncState"("gmailConnectionId");

-- CreateIndex
CREATE INDEX "EmailThread_tenantId_latestMessageAt_idx" ON "EmailThread"("tenantId", "latestMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailThread_gmailConnectionId_gmailThreadId_key" ON "EmailThread"("gmailConnectionId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_sentAt_idx" ON "EmailMessage"("threadId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_threadId_gmailMessageId_key" ON "EmailMessage"("threadId", "gmailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_messageId_gmailAttachmentId_key" ON "Attachment"("messageId", "gmailAttachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Classification_threadId_key" ON "Classification"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadSummary_threadId_key" ON "ThreadSummary"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyOption_threadId_rank_key" ON "ReplyOption"("threadId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "GmailDraft_replyOptionId_key" ON "GmailDraft"("replyOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailDraft_gmailDraftId_key" ON "GmailDraft"("gmailDraftId");

-- CreateIndex
CREATE INDEX "GmailDraft_threadId_status_idx" ON "GmailDraft"("threadId", "status");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_scheduledAt_idx" ON "ProcessingJob"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_tenantId_kind_dedupeKey_key" ON "ProcessingJob"("tenantId", "kind", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncState" ADD CONSTRAINT "SyncState_gmailConnectionId_fkey" FOREIGN KEY ("gmailConnectionId") REFERENCES "GmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_gmailConnectionId_fkey" FOREIGN KEY ("gmailConnectionId") REFERENCES "GmailConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadSummary" ADD CONSTRAINT "ThreadSummary_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyOption" ADD CONSTRAINT "ReplyOption_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailDraft" ADD CONSTRAINT "GmailDraft_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailDraft" ADD CONSTRAINT "GmailDraft_replyOptionId_fkey" FOREIGN KEY ("replyOptionId") REFERENCES "ReplyOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
