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
  v.literal("QUOTA_PAUSED"),
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
    generateThreeSuggestions: v.optional(v.boolean()),
    ...timestamps,
  })
    .index("by_auth_user", ["authUserId"])
    .index("by_email", ["email"]),
  tenants: defineTable({
    slug: v.string(),
    name: v.string(),
    ownerAuthUserId: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_slug", ["slug"])
    .index("by_owner_auth_user", ["ownerAuthUserId"]),
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
    // The authenticated user who connected this mailbox. Immutable after
    // insert: it is the sole basis for mail authorization, so re-pointing it
    // would hand someone else's inbox over. Optional only so the backfill in
    // migrations.ts can run before it is populated.
    ownerUserId: v.optional(v.id("users")),
    googleAccountId: v.string(),
    emailAddress: v.string(),
    encryptedCredentials: v.string(),
    // Which MAIL_ENCRYPTION_KEY generation this mailbox's content is under.
    // Unused until in-place re-encryption tooling exists; see
    // docs/security/mail-encryption.md.
    keyVersion: v.optional(v.number()),
    scopes: v.array(v.string()),
    status: connectionStatus,
    lastError: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_owner", ["ownerUserId"])
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
    phase: v.optional(v.string()),
    backfillPageToken: v.optional(v.string()),
    backfillDone: v.optional(v.boolean()),
    totalThreads: v.optional(v.number()),
    totalMessages: v.optional(v.number()),
    importedThreads: v.optional(v.number()),
    importedMessages: v.optional(v.number()),
    resumeAt: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  }).index("by_connection", ["gmailConnectionId"]),
  // Fields marked `enc` below hold ciphertext produced by convex/crypto.ts,
  // not readable text. Everything else on these tables is metadata that is
  // deliberately left in the clear so it can be indexed; see
  // docs/security/mail-encryption.md for what that metadata reveals.
  emailThreads: defineTable({
    tenantId: v.id("tenants"),
    gmailConnectionId: v.id("gmailConnections"),
    gmailThreadId: v.string(),
    subject: v.optional(v.string()), // enc
    snippet: v.optional(v.string()), // enc
    latestMessageAt: v.number(),
    isUnread: v.boolean(),
    labelIds: v.array(v.string()),
    ...timestamps,
  })
    .index("by_connection_gmail", ["gmailConnectionId", "gmailThreadId"])
    .index("by_connection_latest", ["gmailConnectionId", "latestMessageAt"])
    .index("by_tenant_latest", ["tenantId", "latestMessageAt"]),
  emailMessages: defineTable({
    threadId: v.id("emailThreads"),
    gmailMessageId: v.string(),
    // No internetMessageId column: it duplicated the RFC822 Message-ID that
    // is already inside the encrypted `headers` blob, nothing ever read it,
    // and in the clear it leaked the sending domain.
    fromAddress: v.string(), // enc
    toAddresses: v.optional(v.string()), // enc (JSON array)
    ccAddresses: v.optional(v.string()), // enc (JSON array)
    sentAt: v.number(),
    snippet: v.optional(v.string()), // enc
    bodyText: v.optional(v.string()), // enc
    headers: v.optional(v.string()), // enc (JSON)
    createdAt: v.number(),
  })
    .index("by_thread_gmail", ["threadId", "gmailMessageId"])
    .index("by_thread_sent", ["threadId", "sentAt"])
    .index("by_gmail_message", ["gmailMessageId"]),
  attachments: defineTable({
    messageId: v.id("emailMessages"),
    gmailAttachmentId: v.string(),
    filename: v.optional(v.string()), // enc
    mimeType: v.string(),
    sizeBytes: v.number(),
    contentId: v.optional(v.string()), // enc
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
    title: v.string(), // enc
    note: v.optional(v.string()), // enc
    dueAt: v.number(),
    status: reminderStatus,
    scheduledWorkId: v.optional(v.string()),
    ...timestamps,
  })
    .index("by_user_status_due", ["userId", "status", "dueAt"])
    .index("by_thread", ["threadId"]),
  notifications: defineTable({
    userId: v.id("users"),
    threadId: v.optional(v.id("emailThreads")),
    kind: notificationKind,
    title: v.string(), // enc
    body: v.string(), // enc
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user_read_created", ["userId", "readAt", "createdAt"])
    .index("by_thread", ["threadId"]),
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
    rationale: v.optional(v.string()), // enc
    model: v.string(),
    ...timestamps,
  }).index("by_thread", ["threadId"]),
  threadSummaries: defineTable({
    threadId: v.id("emailThreads"),
    summary: v.string(), // enc
    requestedActions: v.string(), // enc (JSON array)
    model: v.string(),
    ...timestamps,
  }).index("by_thread", ["threadId"]),
  threadAnalyses: defineTable({
    threadId: v.id("emailThreads"),
    schemaVersion: v.string(),
    model: v.string(),
    analysis: v.string(), // enc (JSON)
    safetyFlags: v.string(), // enc (JSON)
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
    body: v.string(), // enc
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
    subject: v.optional(v.string()), // enc
    body: v.string(), // enc
    toAddresses: v.string(), // enc (JSON array)
    ccAddresses: v.string(), // enc (JSON array)
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
    .index("by_tenant_kind_created", ["tenantId", "kind", "createdAt"])
    .index("by_status_scheduled", ["status", "scheduledAt"])
    .index("by_completed", ["completedAt"]),
  auditEvents: defineTable({
    tenantId: v.id("tenants"),
    actorId: v.optional(v.id("users")),
    action: auditAction,
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_created", ["createdAt"]),
  quotaUsage: defineTable({
    scope: v.string(),
    windowKind: v.string(),
    windowStart: v.number(),
    units: v.number(),
    updatedAt: v.number(),
  }).index("by_scope_window", ["scope", "windowKind", "windowStart"]),
});
