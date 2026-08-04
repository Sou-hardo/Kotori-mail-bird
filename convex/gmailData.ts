/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { computeInitialPhase } from "./gmailSync";
import {
  decryptDraft,
  decryptThread,
  encryptMessage,
  encryptThread,
  mailboxBox,
} from "./mailCrypto";
export const connection = internalQuery({
  args: { connectionId: v.id("gmailConnections") },
  handler: (ctx, a) => ctx.db.get(a.connectionId),
});
export const syncContext = internalQuery({
  args: { connectionId: v.id("gmailConnections") },
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection) return null;
    const state = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", connectionId),
      )
      .unique();
    return { connection, state };
  },
});
export const beginSync = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"),
    forceFull: v.boolean(),
    // Set when a run falls back from an expired history checkpoint (404) to
    // a fresh backfill. Unlike forceFull it does not reset import counters,
    // since the already-imported rows in Convex are still valid.
    resetBackfill: v.optional(v.boolean()),
  },
  handler: async (ctx, { connectionId, forceFull, resetBackfill }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection) throw new Error("connection_not_found");
    const state = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", connectionId),
      )
      .unique();
    const now = Date.now();
    if (state) {
      const reset = forceFull || Boolean(resetBackfill);
      const phase = computeInitialPhase(reset ? null : state);
      await ctx.db.patch(state._id, {
        status: "RUNNING",
        lastStartedAt: now,
        lastError: undefined,
        resumeAt: undefined,
        phase,
        ...(forceFull ? { pageToken: undefined } : {}),
        ...(reset
          ? {
              backfillPageToken: undefined,
              backfillDone: false,
              totalThreads: undefined,
              totalMessages: undefined,
              historyId: undefined,
            }
          : {}),
        ...(forceFull ? { importedThreads: 0, importedMessages: 0 } : {}),
        updatedAt: now,
      });
    }
    await ctx.db.insert("auditEvents", {
      tenantId: connection.tenantId,
      action: "SYNC_STARTED",
      targetType: "GmailConnection",
      targetId: String(connectionId),
      createdAt: now,
    });
  },
});
export const failSync = internalMutation({
  args: { connectionId: v.id("gmailConnections"), error: v.string() },
  handler: async (ctx, { connectionId, error }) => {
    const state = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", connectionId),
      )
      .unique();
    if (state)
      await ctx.db.patch(state._id, {
        status: "FAILED",
        lastError: error.slice(0, 2000),
        updatedAt: Date.now(),
      });
  },
});
export const pauseSync = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"),
    resumeAt: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { connectionId, resumeAt, error }) => {
    const state = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", connectionId),
      )
      .unique();
    if (state)
      await ctx.db.patch(state._id, {
        status: "QUOTA_PAUSED",
        phase: "QUOTA_PAUSED",
        resumeAt,
        ...(error !== undefined ? { lastError: error.slice(0, 2000) } : {}),
        updatedAt: Date.now(),
      });
  },
});
// Widened to also carry backfill progress: page cursor, phase, one-time
// mailbox totals from getProfile, and (optionally) the very first history
// checkpoint. historyIdIfUnset only ever writes historyId when the state
// doesn't already have one, so a resumed backfill never clobbers the
// checkpoint captured at the start of the current backfill pass.
export const syncProgress = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"),
    pageToken: v.optional(v.string()),
    backfillPageToken: v.optional(v.string()),
    phase: v.optional(v.string()),
    totalThreads: v.optional(v.number()),
    totalMessages: v.optional(v.number()),
    historyIdIfUnset: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const state = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", a.connectionId),
      )
      .unique();
    if (!state) return;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if ("pageToken" in a) patch.pageToken = a.pageToken;
    if ("backfillPageToken" in a) patch.backfillPageToken = a.backfillPageToken;
    if (a.phase !== undefined) patch.phase = a.phase;
    if (a.totalThreads !== undefined) patch.totalThreads = a.totalThreads;
    if (a.totalMessages !== undefined) patch.totalMessages = a.totalMessages;
    if (a.historyIdIfUnset !== undefined && state.historyId === undefined)
      patch.historyId = a.historyIdIfUnset;
    await ctx.db.patch(state._id, patch);
  },
});
const header = (headers: any[], name: string) =>
  headers?.find((x) => String(x.name).toLowerCase() === name.toLowerCase())
    ?.value;
// Convex mutations run in a V8 isolate without the Node `Buffer` global, so
// base64url decoding has to go through atob/TextDecoder instead.
export const base64UrlToUtf8 = (data: string): string | undefined => {
  try {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return undefined;
  }
};
export const bodyText = (payload: any): string | undefined => {
  if (payload?.mimeType === "text/plain" && payload.body?.data)
    return base64UrlToUtf8(payload.body.data);
  for (const part of payload?.parts ?? []) {
    const found = bodyText(part);
    if (found) return found;
  }
  return undefined;
};
async function incrementImportCounters(
  ctx: { db: any },
  connectionId: Id<"gmailConnections">,
  delta: { threads: number; messages: number },
) {
  const state = await ctx.db
    .query("syncStates")
    .withIndex("by_connection", (q: any) =>
      q.eq("gmailConnectionId", connectionId),
    )
    .unique();
  if (!state) return;
  await ctx.db.patch(state._id, {
    importedThreads: (state.importedThreads ?? 0) + delta.threads,
    importedMessages: (state.importedMessages ?? 0) + delta.messages,
    updatedAt: Date.now(),
  });
}
// Message-granular upsert used by both the incremental (history.list) and
// backfill (messages.list) paths. Only ever touches the one message it was
// given: it never prunes sibling messages from the thread, because a
// partial message fetch has no way to know the thread's full membership
// (that pruning only ever ran off a full threads.get, which neither sync
// path calls anymore).
export const saveMessage = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"),
    gmailThreadId: v.string(),
    message: v.any(),
  },
  handler: async (ctx, { connectionId, gmailThreadId, message }) => {
    const c = await ctx.db.get(connectionId);
    if (!c) throw new Error("connection_not_found");
    const box = mailboxBox(c);
    const now = Date.now();
    let thread = await ctx.db
      .query("emailThreads")
      .withIndex("by_connection_gmail", (q) =>
        q
          .eq("gmailConnectionId", connectionId)
          .eq("gmailThreadId", gmailThreadId),
      )
      .unique();
    const sentAt = Number(message.internalDate) || now;
    const isUnreadMsg = (message.labelIds ?? []).includes("UNREAD");
    const msgLabelIds: string[] = message.labelIds ?? [];
    const subject = header(message.payload?.headers, "Subject");
    let threadInserted = false;
    let latestMessageAt: number;
    if (!thread) {
      latestMessageAt = sentAt;
      const id = await ctx.db.insert("emailThreads", {
        tenantId: c.tenantId,
        gmailConnectionId: connectionId,
        gmailThreadId,
        ...(await encryptThread(box, { subject, snippet: message.snippet })),
        latestMessageAt,
        isUnread: isUnreadMsg,
        labelIds: msgLabelIds,
        createdAt: now,
        updatedAt: now,
      });
      thread = (await ctx.db.get(id))!;
      threadInserted = true;
    } else {
      latestMessageAt = Math.max(thread.latestMessageAt, sentAt);
      const patch: Record<string, unknown> = {
        updatedAt: now,
        isUnread: thread.isUnread || isUnreadMsg,
        labelIds: Array.from(new Set([...thread.labelIds, ...msgLabelIds])),
      };
      if (sentAt >= thread.latestMessageAt) {
        const encrypted = await encryptThread(box, {
          subject,
          snippet: message.snippet,
        });
        patch.latestMessageAt = sentAt;
        patch.snippet = encrypted.snippet;
        if (subject) patch.subject = encrypted.subject;
      }
      await ctx.db.patch(thread._id, patch);
    }
    const old = await ctx.db
      .query("emailMessages")
      .withIndex("by_thread_gmail", (q) =>
        q.eq("threadId", thread!._id).eq("gmailMessageId", message.id),
      )
      .unique();
    const messageData = {
      threadId: thread._id,
      gmailMessageId: message.id,
      internetMessageId: header(message.payload?.headers, "Message-ID"),
      sentAt,
      ...(await encryptMessage(box, {
        fromAddress: header(message.payload?.headers, "From") ?? "",
        toAddresses: (header(message.payload?.headers, "To") ?? "")
          .split(",")
          .filter(Boolean),
        ccAddresses: (header(message.payload?.headers, "Cc") ?? "")
          .split(",")
          .filter(Boolean),
        snippet: message.snippet,
        bodyText: bodyText(message.payload),
        headers: message.payload?.headers,
      })),
    };
    let messageId;
    let messageInserted = false;
    if (old) {
      await ctx.db.patch(old._id, messageData);
      messageId = old._id;
    } else {
      messageId = await ctx.db.insert("emailMessages", {
        ...messageData,
        createdAt: now,
      });
      messageInserted = true;
    }
    const attachmentIds = new Set<string>();
    const walk = async (payload: any) => {
      if (payload?.body?.attachmentId) {
        attachmentIds.add(payload.body.attachmentId);
        const existing = await ctx.db
          .query("attachments")
          .withIndex("by_message_gmail", (q) =>
            q
              .eq("messageId", messageId)
              .eq("gmailAttachmentId", payload.body.attachmentId),
          )
          .unique();
        const attachment = {
          messageId,
          gmailAttachmentId: payload.body.attachmentId,
          filename: await box.enc(
            "attachments.filename",
            payload.filename || undefined,
          ),
          mimeType: payload.mimeType ?? "application/octet-stream",
          sizeBytes: Number(payload.body.size) || 0,
          contentId: await box.enc(
            "attachments.contentId",
            header(payload.headers, "Content-ID"),
          ),
        };
        if (existing) await ctx.db.patch(existing._id, attachment);
        else await ctx.db.insert("attachments", attachment);
      }
      for (const part of payload?.parts ?? []) await walk(part);
    };
    await walk(message.payload);
    for (const attachment of await ctx.db
      .query("attachments")
      .withIndex("by_message_gmail", (q) => q.eq("messageId", messageId))
      .collect())
      if (!attachmentIds.has(attachment.gmailAttachmentId))
        await ctx.db.delete(attachment._id);

    if (threadInserted || messageInserted)
      await incrementImportCounters(ctx, connectionId, {
        threads: threadInserted ? 1 : 0,
        messages: messageInserted ? 1 : 0,
      });

    await ctx.scheduler.runAfter(0, internal.jobs.enqueueInternal, {
      tenantId: c.tenantId,
      kind: "ai.thread.analyze",
      input: { threadId: thread._id, version: String(latestMessageAt) },
      dedupeKey: `${thread._id}:${latestMessageAt}`,
    });
    return thread._id;
  },
});
export const finishSync = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"),
    historyId: v.optional(v.string()),
    // Only present on a backfill-path run; reflects whether Gmail returned
    // no nextPageToken for that run's final page.
    backfillDone: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const s = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", a.connectionId),
      )
      .unique();
    if (s) {
      const backfillDone = a.backfillDone ?? s.backfillDone ?? false;
      await ctx.db.patch(s._id, {
        status: "IDLE",
        ...(a.historyId !== undefined ? { historyId: a.historyId } : {}),
        ...(a.backfillDone !== undefined
          ? { backfillDone: a.backfillDone }
          : {}),
        pageToken: undefined,
        phase: backfillDone ? "INCREMENTAL" : "BACKFILL",
        lastCompletedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    const connection = await ctx.db.get(a.connectionId);
    if (connection)
      await ctx.db.insert("auditEvents", {
        tenantId: connection.tenantId,
        action: "SYNC_COMPLETED",
        targetType: "GmailConnection",
        targetId: String(a.connectionId),
        createdAt: Date.now(),
      });
  },
});
export const deleteGmailMessages = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"),
    gmailMessageIds: v.array(v.string()),
  },
  handler: async (ctx, { connectionId, gmailMessageIds }) => {
    for (const gmailMessageId of gmailMessageIds) {
      const message = await ctx.db
        .query("emailMessages")
        .withIndex("by_gmail_message", (q) =>
          q.eq("gmailMessageId", gmailMessageId),
        )
        .unique();
      if (!message) continue;
      const thread = await ctx.db.get(message.threadId);
      if (!thread || thread.gmailConnectionId !== connectionId) continue;
      for (const attachment of await ctx.db
        .query("attachments")
        .withIndex("by_message_gmail", (q) => q.eq("messageId", message._id))
        .collect())
        await ctx.db.delete(attachment._id);
      await ctx.db.delete(message._id);
    }
  },
});
export const draftContext = internalQuery({
  args: { draftId: v.id("gmailDrafts") },
  handler: async (ctx, { draftId }) => {
    const draft = await ctx.db.get(draftId);
    if (!draft) return null;
    const thread = await ctx.db.get(draft.threadId);
    if (!thread) return null;
    const connection = await ctx.db.get(thread.gmailConnectionId);
    if (!connection) return null;
    // The Gmail action needs readable subject/body/recipients to build the
    // RFC822 message; decryption stays inside Convex and the plaintext never
    // touches another table.
    const box = mailboxBox(connection);
    return {
      draft: await decryptDraft(box, draft),
      thread: await decryptThread(box, thread),
      connection,
    };
  },
});
export const markDraftCreated = internalMutation({
  args: { draftId: v.id("gmailDrafts"), gmailDraftId: v.string() },
  handler: async (ctx, a) => {
    const d = await ctx.db.get(a.draftId);
    if (!d) return;
    await ctx.db.patch(d._id, {
      gmailDraftId: a.gmailDraftId,
      status: "CREATED_IN_GMAIL",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditEvents", {
      tenantId: (await ctx.db.get(d.threadId))!.tenantId,
      action: "GMAIL_DRAFT_CREATED",
      targetType: "GmailDraft",
      targetId: String(d._id),
      createdAt: Date.now(),
    });
  },
});
