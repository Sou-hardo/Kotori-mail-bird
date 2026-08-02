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
    const connection = await ctx.runQuery(internal.gmailData.connection, {
      connectionId: args.connectionId,
    });
    if (!connection || connection.status !== "ACTIVE") return { skipped: true };
    const oauth = new google.auth.OAuth2(
      process.env.GMAIL_OAUTH_CLIENT_ID,
      process.env.GMAIL_OAUTH_CLIENT_SECRET,
      process.env.GMAIL_OAUTH_REDIRECT_URI,
    );
    oauth.setCredentials(await decrypt(connection.encryptedCredentials));
    const gmail = google.gmail({ version: "v1", auth: oauth });
    const listing = await gmail.users.threads.list({
      userId: "me",
      labelIds: ["INBOX"],
      maxResults: 50,
    });
    let saved = 0;
    for (const summary of listing.data.threads ?? []) {
      if (!summary.id) continue;
      const response = await gmail.users.threads.get({
        userId: "me",
        id: summary.id,
        format: "full",
      });
      await ctx.runMutation(internal.gmailData.saveThread, {
        connectionId: args.connectionId,
        thread: response.data as any,
      });
      saved++;
    }
    await ctx.runMutation(internal.gmailData.finishSync, {
      connectionId: args.connectionId,
      historyId: listing.data.historyId ?? undefined,
    });
    return { threads: saved };
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
    const headers = [
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
