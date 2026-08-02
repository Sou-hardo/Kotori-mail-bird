"use node";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { google } from "googleapis";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const decrypt = async (encrypted: string) => {
  const { decryptCredentials } =
    await import("../src/lib/security/credentials.js");
  return decryptCredentials<Record<string, unknown>>(
    encrypted,
    process.env.CREDENTIAL_ENCRYPTION_KEY!,
  );
};

export const sync = internalAction({
  args: {
    jobId: v.id("processingJobs"),
    connectionId: v.id("gmailConnections"),
    forceFull: v.boolean(),
  },
  handler: async (ctx, args) => {
    const syncContext = await ctx.runQuery(internal.gmailData.syncContext, {
      connectionId: args.connectionId,
    });
    const connection = syncContext?.connection;
    if (!connection || connection.status !== "ACTIVE") return { skipped: true };
    const oauth = new google.auth.OAuth2(
      process.env.GMAIL_OAUTH_CLIENT_ID,
      process.env.GMAIL_OAUTH_CLIENT_SECRET,
      process.env.GMAIL_OAUTH_REDIRECT_URI,
    );
    oauth.setCredentials(await decrypt(connection.encryptedCredentials));
    const gmail = google.gmail({ version: "v1", auth: oauth });
    await ctx.runMutation(internal.gmailData.beginSync, {
      connectionId: args.connectionId,
      forceFull: args.forceFull,
    });
    try {
      const threadIds = new Set<string>();
      const deletedMessageIds = new Set<string>();
      let newestHistoryId = syncContext?.state?.historyId;
      const useHistory =
        !args.forceFull && Boolean(syncContext?.state?.historyId);
      if (useHistory) {
        let pageToken: string | undefined = syncContext?.state?.pageToken;
        for (let page = 0; page < 4; page++) {
          const response = await gmail.users.history.list({
            userId: "me",
            startHistoryId: syncContext!.state!.historyId!,
            pageToken,
            maxResults: 100,
            historyTypes: [
              "messageAdded",
              "messageDeleted",
              "labelAdded",
              "labelRemoved",
            ],
          });
          newestHistoryId = response.data.historyId ?? newestHistoryId;
          for (const history of response.data.history ?? []) {
            for (const message of [
              ...(history.messagesAdded ?? []),
              ...(history.labelsAdded ?? []),
              ...(history.labelsRemoved ?? []),
            ].map((item) => item.message))
              if (message?.threadId) threadIds.add(message.threadId);
            for (const item of history.messagesDeleted ?? [])
              if (item.message?.id) deletedMessageIds.add(item.message.id);
          }
          pageToken = response.data.nextPageToken ?? undefined;
          if (!pageToken) break;
          if (page === 3) throw new Error("gmail_history_page_limit_exceeded");
        }
      } else {
        let pageToken: string | undefined;
        for (let page = 0; page < 4 && threadIds.size < 200; page++) {
          const listing = await gmail.users.threads.list({
            userId: "me",
            labelIds: ["INBOX"],
            q: "newer_than:14d",
            maxResults: Math.min(50, 200 - threadIds.size),
            pageToken,
          });
          newestHistoryId =
            listing.data.threads?.[0]?.historyId ?? newestHistoryId;
          for (const thread of listing.data.threads ?? [])
            if (thread.id) threadIds.add(thread.id);
          pageToken = listing.data.nextPageToken ?? undefined;
          if (!pageToken) break;
        }
      }
      if (deletedMessageIds.size)
        await ctx.runMutation(internal.gmailData.deleteGmailMessages, {
          connectionId: args.connectionId,
          gmailMessageIds: [...deletedMessageIds],
        });
      let saved = 0;
      for (const id of threadIds) {
        const response = await gmail.users.threads.get({
          userId: "me",
          id,
          format: "full",
        });
        newestHistoryId = response.data.historyId ?? newestHistoryId;
        await ctx.runMutation(internal.gmailData.saveThread, {
          connectionId: args.connectionId,
          thread: response.data as any,
        });
        saved++;
      }
      await ctx.runMutation(internal.gmailData.finishSync, {
        connectionId: args.connectionId,
        historyId: newestHistoryId,
      });
      return { threads: saved, incremental: useHistory };
    } catch (error) {
      await ctx.runMutation(internal.gmailData.failSync, {
        connectionId: args.connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const createDraft = internalAction({
  args: { jobId: v.id("processingJobs"), draftId: v.id("gmailDrafts") },
  handler: async (ctx, { draftId }) => {
    const data = await ctx.runQuery(internal.gmailData.draftContext, {
      draftId,
    });
    if (!data) throw new Error("draft_not_found");
    if (data.draft.status === "CREATED_IN_GMAIL")
      return { gmailDraftId: data.draft.gmailDraftId, deduplicated: true };
    const oauth = new google.auth.OAuth2(
      process.env.GMAIL_OAUTH_CLIENT_ID,
      process.env.GMAIL_OAUTH_CLIENT_SECRET,
      process.env.GMAIL_OAUTH_REDIRECT_URI,
    );
    oauth.setCredentials(await decrypt(data.connection.encryptedCredentials));
    const gmail = google.gmail({ version: "v1", auth: oauth });
    const operationMessageId = `<kotori-${draftId}@draft.local>`;
    const prior = await gmail.users.drafts.list({
      userId: "me",
      q: `rfc822msgid:${operationMessageId}`,
      maxResults: 1,
    });
    const priorId = prior.data.drafts?.[0]?.id;
    if (priorId) {
      await ctx.runMutation(internal.gmailData.markDraftCreated, {
        draftId,
        gmailDraftId: priorId,
      });
      return { gmailDraftId: priorId, reconciled: true };
    }
    const headers = [
      `Message-ID: ${operationMessageId}`,
      `To: ${data.draft.toAddresses.join(", ")}`,
      data.draft.ccAddresses.length
        ? `Cc: ${data.draft.ccAddresses.join(", ")}`
        : "",
      `Subject: ${data.draft.subject ?? data.thread.subject ?? ""}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      data.draft.body,
    ]
      .filter(Boolean)
      .join("\r\n");
    const raw = Buffer.from(headers).toString("base64url");
    const result = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, threadId: data.thread.gmailThreadId } },
    });
    if (!result.data.id) throw new Error("gmail_draft_missing_id");
    await ctx.runMutation(internal.gmailData.markDraftCreated, {
      draftId,
      gmailDraftId: result.data.id,
    });
    return { gmailDraftId: result.data.id };
  },
});
