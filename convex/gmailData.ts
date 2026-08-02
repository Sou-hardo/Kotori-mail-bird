/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
export const connection = internalQuery({
  args: { connectionId: v.id("gmailConnections") },
  handler: (ctx, a) => ctx.db.get(a.connectionId),
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
      if (old) continue;
      await ctx.db.insert("emailMessages", {
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
        createdAt: now,
      });
    }
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
