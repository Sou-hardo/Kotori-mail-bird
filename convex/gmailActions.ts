"use node";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { google } from "googleapis";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { GMAIL_UNIT_COST } from "./quota";
import {
  classifyGmailError,
  computeBackfillAdvance,
  extractGmailErrorCode,
  resolveWindowDays,
} from "./gmailSync";

type SyncContext = {
  connection: Doc<"gmailConnections">;
  state: Doc<"syncStates"> | null;
};

type SyncResult =
  | { skipped: true }
  | { paused: true }
  | { messages: number; incremental: boolean };

type DraftContext = {
  draft: Doc<"gmailDrafts">;
  thread: Doc<"emailThreads">;
  connection: Doc<"gmailConnections">;
};

type DraftResult = {
  gmailDraftId: string | undefined;
  deduplicated?: true;
  reconciled?: true;
};

const decrypt = async (encrypted: string) => {
  const { decryptCredentials } =
    await import("../src/lib/security/credentials.js");
  return decryptCredentials<Record<string, unknown>>(
    encrypted,
    process.env.CREDENTIAL_ENCRYPTION_KEY!,
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries transient 5xx failures inline (a handful of quick attempts);
// anything else (404, 429, 4xx) is left for the caller to classify.
async function withGmailRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      const code = extractGmailErrorCode(error);
      if (code !== undefined && code >= 500 && attempt < attempts) {
        await sleep(500 * attempt);
        continue;
      }
      throw error;
    }
  }
}

type QuotaDecision = { ok: true } | { ok: false; retryAfterMs: number };

// Reserves quota before every Gmail request. A short refusal (<60s) is
// worth a single blocking retry; anything longer is returned to the caller
// so the run can persist progress and pause cleanly instead of blocking a
// Convex action for minutes/hours.
async function meter(
  ctx: any,
  connectionId: Id<"gmailConnections">,
  method: keyof typeof GMAIL_UNIT_COST,
): Promise<QuotaDecision> {
  const units = GMAIL_UNIT_COST[method];
  let decision: QuotaDecision = await ctx.runMutation(internal.quota.reserve, {
    connectionId,
    units,
  });
  if (!decision.ok && decision.retryAfterMs < 60_000) {
    await sleep(decision.retryAfterMs);
    decision = await ctx.runMutation(internal.quota.reserve, {
      connectionId,
      units,
    });
  }
  return decision;
}

export const sync = internalAction({
  args: {
    jobId: v.id("processingJobs"),
    connectionId: v.id("gmailConnections"),
    forceFull: v.boolean(),
  },
  handler: async (ctx, args): Promise<SyncResult> => {
    const syncContext: SyncContext | null = await ctx.runQuery(
      internal.gmailData.syncContext,
      { connectionId: args.connectionId },
    );
    const connection = syncContext?.connection;
    if (!connection || connection.status !== "ACTIVE") return { skipped: true };
    const oauth = new google.auth.OAuth2(
      process.env.GMAIL_OAUTH_CLIENT_ID,
      process.env.GMAIL_OAUTH_CLIENT_SECRET,
      process.env.GMAIL_OAUTH_REDIRECT_URI,
    );
    oauth.setCredentials(await decrypt(connection.encryptedCredentials));
    const gmail = google.gmail({ version: "v1", auth: oauth });

    const state = syncContext.state;
    let useHistory =
      !args.forceFull &&
      Boolean(state?.backfillDone) &&
      Boolean(state?.historyId);
    let resetBackfill = false;

    const pause = async (
      resumeAt: number,
      error?: unknown,
    ): Promise<SyncResult> => {
      await ctx.runMutation(internal.gmailData.pauseSync, {
        connectionId: args.connectionId,
        resumeAt,
        error:
          error instanceof Error
            ? error.message
            : error !== undefined
              ? String(error)
              : undefined,
      });
      return { paused: true };
    };

    for (;;) {
      await ctx.runMutation(internal.gmailData.beginSync, {
        connectionId: args.connectionId,
        forceFull: args.forceFull,
        resetBackfill,
      });
      try {
        if (useHistory) {
          let pageToken = state?.pageToken;
          let newestHistoryId = state?.historyId;
          let messagesSaved = 0;
          for (let page = 0; page < 4; page++) {
            const listDecision = await meter(
              ctx,
              args.connectionId,
              "history.list",
            );
            if (!listDecision.ok)
              return pause(Date.now() + listDecision.retryAfterMs);
            const response = await withGmailRetry(() =>
              gmail.users.history.list({
                userId: "me",
                startHistoryId: state!.historyId!,
                pageToken,
                maxResults: 100,
                historyTypes: [
                  "messageAdded",
                  "messageDeleted",
                  "labelAdded",
                  "labelRemoved",
                ],
              }),
            );
            newestHistoryId = response.data.historyId ?? newestHistoryId;
            const messageRefs = new Map<string, string>();
            const deletedMessageIds = new Set<string>();
            for (const history of response.data.history ?? []) {
              for (const item of [
                ...(history.messagesAdded ?? []),
                ...(history.labelsAdded ?? []),
                ...(history.labelsRemoved ?? []),
              ])
                if (item.message?.id && item.message?.threadId)
                  messageRefs.set(item.message.id, item.message.threadId);
              for (const item of history.messagesDeleted ?? [])
                if (item.message?.id) deletedMessageIds.add(item.message.id);
            }
            if (deletedMessageIds.size)
              await ctx.runMutation(internal.gmailData.deleteGmailMessages, {
                connectionId: args.connectionId,
                gmailMessageIds: [...deletedMessageIds],
              });
            for (const [messageId, threadId] of messageRefs) {
              const getDecision = await meter(
                ctx,
                args.connectionId,
                "messages.get",
              );
              if (!getDecision.ok) {
                await ctx.runMutation(internal.gmailData.syncProgress, {
                  connectionId: args.connectionId,
                  pageToken,
                });
                return pause(Date.now() + getDecision.retryAfterMs);
              }
              const messageResponse = await withGmailRetry(() =>
                gmail.users.messages.get({
                  userId: "me",
                  id: messageId,
                  format: "full",
                }),
              );
              await ctx.runMutation(internal.gmailData.saveMessage, {
                connectionId: args.connectionId,
                gmailThreadId: threadId,
                message: messageResponse.data,
              });
              messagesSaved++;
            }
            pageToken = response.data.nextPageToken ?? undefined;
            // Advance the cursor only after this page's effects are durable.
            // A failed Gmail fetch or Convex mutation will retry this page.
            await ctx.runMutation(internal.gmailData.syncProgress, {
              connectionId: args.connectionId,
              pageToken,
            });
            if (!pageToken) break;
          }
          await ctx.runMutation(internal.gmailData.finishSync, {
            connectionId: args.connectionId,
            historyId: newestHistoryId,
          });
          return { messages: messagesSaved, incremental: true };
        } else {
          const windowDays = resolveWindowDays(state?.windowDays);
          let historyId = state?.historyId;
          if (!historyId) {
            // Read the checkpoint before the backfill snapshot so mail
            // arriving during the backfill is still picked up once the
            // connection switches to incremental history syncing.
            const profileDecision = await meter(
              ctx,
              args.connectionId,
              "getProfile",
            );
            if (!profileDecision.ok)
              return pause(Date.now() + profileDecision.retryAfterMs);
            const profile = await withGmailRetry(() =>
              gmail.users.getProfile({ userId: "me" }),
            );
            historyId = profile.data.historyId ?? undefined;
            await ctx.runMutation(internal.gmailData.syncProgress, {
              connectionId: args.connectionId,
              historyIdIfUnset: historyId,
              totalThreads: profile.data.threadsTotal ?? undefined,
              totalMessages: profile.data.messagesTotal ?? undefined,
              phase: "BACKFILL",
            });
          }
          let pageToken = state?.backfillPageToken;
          let backfillDone = false;
          let messagesSaved = 0;
          for (let page = 0; page < 4; page++) {
            const listDecision = await meter(
              ctx,
              args.connectionId,
              "messages.list",
            );
            if (!listDecision.ok)
              return pause(Date.now() + listDecision.retryAfterMs);
            const listing = await withGmailRetry(() =>
              gmail.users.messages.list({
                userId: "me",
                labelIds: ["INBOX"],
                q: `newer_than:${windowDays}d`,
                maxResults: 100,
                pageToken,
              }),
            );
            for (const item of listing.data.messages ?? []) {
              if (!item.id || !item.threadId) continue;
              const getDecision = await meter(
                ctx,
                args.connectionId,
                "messages.get",
              );
              if (!getDecision.ok) {
                await ctx.runMutation(internal.gmailData.syncProgress, {
                  connectionId: args.connectionId,
                  backfillPageToken: pageToken,
                });
                return pause(Date.now() + getDecision.retryAfterMs);
              }
              const messageResponse = await withGmailRetry(() =>
                gmail.users.messages.get({
                  userId: "me",
                  id: item.id!,
                  format: "full",
                }),
              );
              await ctx.runMutation(internal.gmailData.saveMessage, {
                connectionId: args.connectionId,
                gmailThreadId: item.threadId,
                message: messageResponse.data,
              });
              messagesSaved++;
            }
            const advance = computeBackfillAdvance(listing.data.nextPageToken);
            pageToken = advance.backfillPageToken;
            backfillDone = advance.backfillDone;
            // Advance the cursor only after this page's writes are durable.
            await ctx.runMutation(internal.gmailData.syncProgress, {
              connectionId: args.connectionId,
              backfillPageToken: pageToken,
            });
            if (backfillDone) break;
          }
          await ctx.runMutation(internal.gmailData.finishSync, {
            connectionId: args.connectionId,
            backfillDone,
          });
          return { messages: messagesSaved, incremental: false };
        }
      } catch (error) {
        const outcome = classifyGmailError(error, Date.now());
        if (outcome.kind === "fallback_full") {
          useHistory = false;
          resetBackfill = true;
          continue;
        }
        if (outcome.kind === "pause") return pause(outcome.resumeAt, error);
        await ctx.runMutation(internal.gmailData.failSync, {
          connectionId: args.connectionId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  },
});

export const createDraft = internalAction({
  args: { jobId: v.id("processingJobs"), draftId: v.id("gmailDrafts") },
  handler: async (ctx, { draftId }): Promise<DraftResult> => {
    const data: DraftContext | null = await ctx.runQuery(
      internal.gmailData.draftContext,
      { draftId },
    );
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
    const connectionId = data.connection._id;

    const listDecision = await meter(ctx, connectionId, "drafts.list");
    if (!listDecision.ok) throw new Error("gmail_quota_exhausted");
    const operationMessageId = `<kotori-${draftId}@draft.local>`;
    const prior = await withGmailRetry(() =>
      gmail.users.drafts.list({
        userId: "me",
        q: `rfc822msgid:${operationMessageId}`,
        maxResults: 1,
      }),
    );
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
    const createDecision = await meter(ctx, connectionId, "drafts.create");
    if (!createDecision.ok) throw new Error("gmail_quota_exhausted");
    const result = await withGmailRetry(() =>
      gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw, threadId: data.thread.gmailThreadId } },
      }),
    );
    if (!result.data.id) throw new Error("gmail_draft_missing_id");
    await ctx.runMutation(internal.gmailData.markDraftCreated, {
      draftId,
      gmailDraftId: result.data.id,
    });
    return { gmailDraftId: result.data.id };
  },
});
