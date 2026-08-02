import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const tenantRole = v.union(
  v.literal("OWNER"),
  v.literal("ADMIN"),
  v.literal("MEMBER"),
);
export const connectionStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("REAUTH_REQUIRED"),
  v.literal("REVOKED"),
  v.literal("ERROR"),
);
export const syncStatus = v.union(
  v.literal("IDLE"),
  v.literal("RUNNING"),
  v.literal("FAILED"),
);
export const threadCategory = v.union(
  v.literal("ACTION_REQUIRED"),
  v.literal("WAITING"),
  v.literal("FYI"),
  v.literal("NEWSLETTER"),
  v.literal("RECEIPT"),
  v.literal("SPAM"),
  v.literal("UNKNOWN"),
);
export const processingStatus = v.union(
  v.literal("PENDING"),
  v.literal("RUNNING"),
  v.literal("SUCCEEDED"),
  v.literal("FAILED"),
  v.literal("CANCELLED"),
  v.literal("DEAD_LETTER"),
);
export const draftStatus = v.union(
  v.literal("SUGGESTED"),
  v.literal("APPROVED"),
  v.literal("CREATED_IN_GMAIL"),
  v.literal("DISCARDED"),
);
export const reminderStatus = v.union(
  v.literal("OPEN"),
  v.literal("SNOOZED"),
  v.literal("DONE"),
);
export const notificationKind = v.union(
  v.literal("ATTENTION"),
  v.literal("FOLLOW_UP"),
  v.literal("DRAFT_READY"),
  v.literal("SYSTEM"),
);
export const auditAction = v.union(
  v.literal("CONNECTION_CREATED"),
  v.literal("CONNECTION_REVOKED"),
  v.literal("SYNC_STARTED"),
  v.literal("SYNC_COMPLETED"),
  v.literal("CLASSIFICATION_CREATED"),
  v.literal("REPLY_GENERATED"),
  v.literal("REPLY_EDITED"),
  v.literal("REPLY_REJECTED"),
  v.literal("REPLY_APPROVED"),
  v.literal("GMAIL_DRAFT_CREATED"),
);
const timestamps = { createdAt: v.number(), updatedAt: v.number() };

export default defineSchema({
  users: defineTable({
    authUserId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_auth_user", ["authUserId"])
    .index("by_email", ["email"]),
  tenants: defineTable({
    slug: v.string(),
    name: v.string(),
    ...timestamps,
  }).index("by_slug", ["slug"]),
  memberships: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    role: tenantRole,
    createdAt: v.number(),
  })
    .index("by_tenant_user", ["tenantId", "userId"])
    .index("by_user", ["userId"]),
  gmailConnections: defineTable({
    tenantId: v.id("tenants"),
    googleAccountId: v.string(),
    emailAddress: v.string(),
    encryptedCredentials: v.string(),
    scopes: v.array(v.string()),
    status: connectionStatus,
    lastError: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_tenant_google", ["tenantId", "googleAccountId"])
    .index("by_tenant_email", ["tenantId", "emailAddress"])
    .index("by_tenant_status", ["tenantId", "status"]),
  syncStates: defineTable({
    gmailConnectionId: v.id("gmailConnections"),
    historyId: v.optional(v.string()),
    pageToken: v.optional(v.string()),
    status: syncStatus,
    lastStartedAt: v.optional(v.number()),
    lastCompletedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_connection", ["gmailConnectionId"]),
  emailThreads: defineTable({
    tenantId: v.id("tenants"),
    gmailConnectionId: v.id("gmailConnections"),
    gmailThreadId: v.string(),
    subject: v.optional(v.string()),
    snippet: v.optional(v.string()),
    latestMessageAt: v.number(),
    isUnread: v.boolean(),
    labelIds: v.array(v.string()),
    ...timestamps,
  })
    .index("by_connection_gmail", ["gmailConnectionId", "gmailThreadId"])
    .index("by_tenant_latest", ["tenantId", "latestMessageAt"]),
  emailMessages: defineTable({
    threadId: v.id("emailThreads"),
    gmailMessageId: v.string(),
    internetMessageId: v.optional(v.string()),
    fromAddress: v.string(),
    toAddresses: v.array(v.string()),
    ccAddresses: v.array(v.string()),
    sentAt: v.number(),
    snippet: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    bodyHtml: v.optional(v.string()),
    headers: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_thread_gmail", ["threadId", "gmailMessageId"])
    .index("by_thread_sent", ["threadId", "sentAt"]),
  attachments: defineTable({
    messageId: v.id("emailMessages"),
    gmailAttachmentId: v.string(),
    filename: v.optional(v.string()),
    mimeType: v.string(),
    sizeBytes: v.number(),
    contentId: v.optional(v.string()),
  }).index("by_message_gmail", ["messageId", "gmailAttachmentId"]),
  identityProfiles: defineTable({
    userId: v.id("users"),
    label: v.string(),
    displayName: v.string(),
    email: v.string(),
    role: v.optional(v.string()),
    company: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    pronouns: v.optional(v.string()),
    signature: v.string(),
    closing: v.string(),
    isDefault: v.boolean(),
    ...timestamps,
  })
    .index("by_user_label", ["userId", "label"])
    .index("by_user_default", ["userId", "isDefault"]),
  followUpReminders: defineTable({
    userId: v.id("users"),
    threadId: v.optional(v.id("emailThreads")),
    title: v.string(),
    note: v.optional(v.string()),
    dueAt: v.number(),
    status: reminderStatus,
    scheduledWorkId: v.optional(v.string()),
    ...timestamps,
  }).index("by_user_status_due", ["userId", "status", "dueAt"]),
  notifications: defineTable({
    userId: v.id("users"),
    threadId: v.optional(v.id("emailThreads")),
    kind: notificationKind,
    title: v.string(),
    body: v.string(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user_read_created", ["userId", "readAt", "createdAt"]),
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_endpoint", ["endpoint"])
    .index("by_user", ["userId"]),
  classifications: defineTable({
    threadId: v.id("emailThreads"),
    category: threadCategory,
    confidence: v.number(),
    rationale: v.optional(v.string()),
    model: v.string(),
    ...timestamps,
  }).index("by_thread", ["threadId"]),
  threadSummaries: defineTable({
    threadId: v.id("emailThreads"),
    summary: v.string(),
    requestedActions: v.array(v.string()),
    model: v.string(),
    ...timestamps,
  }).index("by_thread", ["threadId"]),
  threadAnalyses: defineTable({
    threadId: v.id("emailThreads"),
    schemaVersion: v.string(),
    model: v.string(),
    analysis: v.any(),
    safetyFlags: v.any(),
    createdAt: v.number(),
  }).index("by_thread_created", ["threadId", "createdAt"]),
  replyGenerations: defineTable({
    threadId: v.id("emailThreads"),
    schemaVersion: v.string(),
    model: v.string(),
    intent: v.string(),
    tone: v.string(),
    length: v.string(),
    identity: v.string(),
    closing: v.string(),
    requiredReviewFlags: v.array(v.string()),
    acknowledgedFlags: v.array(v.string()),
    ...timestamps,
  }).index("by_thread_created", ["threadId", "createdAt"]),
  replyOptions: defineTable({
    threadId: v.id("emailThreads"),
    generationId: v.optional(v.id("replyGenerations")),
    tone: v.string(),
    body: v.string(),
    model: v.string(),
    rank: v.number(),
    intent: v.optional(v.string()),
    version: v.number(),
    createdAt: v.number(),
  })
    .index("by_generation_rank", ["generationId", "rank"])
    .index("by_thread", ["threadId"]),
  gmailDrafts: defineTable({
    threadId: v.id("emailThreads"),
    replyOptionId: v.optional(v.id("replyOptions")),
    gmailDraftId: v.optional(v.string()),
    status: draftStatus,
    subject: v.optional(v.string()),
    body: v.string(),
    toAddresses: v.array(v.string()),
    ccAddresses: v.array(v.string()),
    sourceMessageId: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_reply_option", ["replyOptionId"])
    .index("by_gmail_draft", ["gmailDraftId"])
    .index("by_thread_status", ["threadId", "status"]),
  processingJobs: defineTable({
    tenantId: v.id("tenants"),
    kind: v.string(),
    dedupeKey: v.optional(v.string()),
    status: processingStatus,
    input: v.optional(v.any()),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    attempts: v.number(),
    maxAttempts: v.number(),
    workId: v.optional(v.string()),
    scheduledAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    ...timestamps,
  })
    .index("by_tenant_kind_dedupe", ["tenantId", "kind", "dedupeKey"])
    .index("by_status_scheduled", ["status", "scheduledAt"]),
  auditEvents: defineTable({
    tenantId: v.id("tenants"),
    actorId: v.optional(v.id("users")),
    action: auditAction,
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_tenant_created", ["tenantId", "createdAt"]),
});
