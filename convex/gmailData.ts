/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
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
  args: { connectionId: v.id("gmailConnections"), forceFull: v.boolean() },
  handler: async (ctx, { connectionId, forceFull }) => {
    const connection = await ctx.db.get(connectionId);
    if (!connection) throw new Error("connection_not_found");
    const state = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", connectionId),
      )
      .unique();
    const now = Date.now();
    if (state)
      await ctx.db.patch(state._id, {
        status: "RUNNING",
        lastStartedAt: now,
        lastError: undefined,
        ...(forceFull ? { pageToken: undefined } : {}),
        updatedAt: now,
      });
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
const header = (headers: any[], name: string) =>
  headers?.find((x) => String(x.name).toLowerCase() === name.toLowerCase())
    ?.value;
const bodyText = (payload: any): string | undefined => {
  if (payload?.mimeType === "text/plain" && payload.body?.data)
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  for (const part of payload?.parts ?? []) {
    const found = bodyText(part);
    if (found) return found;
  }
  return undefined;
};
export const saveThread = internalMutation({
  args: { connectionId: v.id("gmailConnections"), thread: v.any() },
  handler: async (ctx, { connectionId, thread }) => {
    const c = await ctx.db.get(connectionId);
    if (!c) throw new Error("connection_not_found");
    const now = Date.now();
    let row = await ctx.db
      .query("emailThreads")
      .withIndex("by_connection_gmail", (q) =>
        q.eq("gmailConnectionId", connectionId).eq("gmailThreadId", thread.id),
      )
      .unique();
    const messages = thread.messages ?? [];
    const latest = Math.max(
      ...messages.map((m: any) => Number(m.internalDate) || now),
    );
    const first = messages[0];
    const data = {
      tenantId: c.tenantId,
      gmailConnectionId: connectionId,
      gmailThreadId: thread.id,
      subject: header(first?.payload?.headers, "Subject"),
      snippet: thread.snippet,
      latestMessageAt: latest,
      isUnread: messages.some((m: any) =>
        (m.labelIds ?? []).includes("UNREAD"),
      ),
      labelIds: Array.from(
        new Set(messages.flatMap((m: any) => m.labelIds ?? [])),
      ) as string[],
      updatedAt: now,
    };
    if (row) await ctx.db.patch(row._id, data);
    else {
      const id = await ctx.db.insert("emailThreads", {
        ...data,
        createdAt: now,
      });
      row = (await ctx.db.get(id))!;
    }
    for (const m of messages) {
      if (!m.id) continue;
      const old = await ctx.db
        .query("emailMessages")
        .withIndex("by_thread_gmail", (q) =>
          q.eq("threadId", row!._id).eq("gmailMessageId", m.id),
        )
        .unique();
      const messageData = {
        threadId: row._id,
        gmailMessageId: m.id,
        internetMessageId: header(m.payload?.headers, "Message-ID"),
        fromAddress: header(m.payload?.headers, "From") ?? "",
        toAddresses: (header(m.payload?.headers, "To") ?? "")
          .split(",")
          .filter(Boolean),
        ccAddresses: (header(m.payload?.headers, "Cc") ?? "")
          .split(",")
          .filter(Boolean),
        sentAt: Number(m.internalDate) || now,
        snippet: m.snippet,
        bodyText: bodyText(m.payload),
        headers: m.payload?.headers,
      };
      let messageId;
      if (old) {
        await ctx.db.patch(old._id, messageData);
        messageId = old._id;
      } else
        messageId = await ctx.db.insert("emailMessages", {
          ...messageData,
          createdAt: now,
        });
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
            filename: payload.filename || undefined,
            mimeType: payload.mimeType ?? "application/octet-stream",
            sizeBytes: Number(payload.body.size) || 0,
            contentId: header(payload.headers, "Content-ID"),
          };
          if (existing) await ctx.db.patch(existing._id, attachment);
          else await ctx.db.insert("attachments", attachment);
        }
        for (const part of payload?.parts ?? []) await walk(part);
      };
      await walk(m.payload);
      for (const attachment of await ctx.db
        .query("attachments")
        .withIndex("by_message_gmail", (q) => q.eq("messageId", messageId))
        .collect())
        if (!attachmentIds.has(attachment.gmailAttachmentId))
          await ctx.db.delete(attachment._id);
    }
    const liveMessageIds = new Set(
      messages.map((m: any) => m.id).filter(Boolean),
    );
    for (const old of await ctx.db
      .query("emailMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadId", row!._id))
      .collect())
      if (!liveMessageIds.has(old.gmailMessageId)) {
        for (const attachment of await ctx.db
          .query("attachments")
          .withIndex("by_message_gmail", (q) => q.eq("messageId", old._id))
          .collect())
          await ctx.db.delete(attachment._id);
        await ctx.db.delete(old._id);
      }
    await ctx.scheduler.runAfter(0, internal.jobs.enqueueInternal, {
      tenantId: c.tenantId,
      kind: "ai.thread.analyze",
      input: { threadId: row._id, version: String(now) },
      dedupeKey: `${row._id}:${latest}`,
    });
    return row._id;
  },
});
export const finishSync = internalMutation({
  args: {
    connectionId: v.id("gmailConnections"),
    historyId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const s = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", a.connectionId),
      )
      .unique();
    if (s)
      await ctx.db.patch(s._id, {
        status: "IDLE",
        historyId: a.historyId,
        lastCompletedAt: Date.now(),
        updatedAt: Date.now(),
      });
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
    const threads = await ctx.db
      .query("emailThreads")
      .withIndex("by_connection_gmail", (q) =>
        q.eq("gmailConnectionId", connectionId),
      )
      .collect();
    const wanted = new Set(gmailMessageIds);
    for (const thread of threads)
      for (const message of await ctx.db
        .query("emailMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadId", thread._id))
        .collect())
        if (wanted.has(message.gmailMessageId)) {
          for (const attachment of await ctx.db
            .query("attachments")
            .withIndex("by_message_gmail", (q) =>
              q.eq("messageId", message._id),
            )
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
    return connection ? { draft, thread, connection } : null;
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
