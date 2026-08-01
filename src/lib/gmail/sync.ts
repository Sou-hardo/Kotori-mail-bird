import type { GmailConnection } from "@/generated/prisma/client";
import type { gmail_v1 } from "googleapis";
import { db } from "@/lib/db";
import { getGmailService, isGmailHistoryExpired } from "@/lib/gmail/service";
import { normalizeThread } from "@/lib/gmail/normalize";

export type SyncResult = {
  mode: "initial" | "incremental" | "bounded-resync";
  threads: number;
  historyId?: string;
};

async function saveThread(
  connection: GmailConnection,
  raw: gmail_v1.Schema$Thread,
) {
  const thread = normalizeThread(raw);
  await db.$transaction(async (tx) => {
    const saved = await tx.emailThread.upsert({
      where: {
        gmailConnectionId_gmailThreadId: {
          gmailConnectionId: connection.id,
          gmailThreadId: thread.id,
        },
      },
      create: {
        tenantId: connection.tenantId,
        gmailConnectionId: connection.id,
        gmailThreadId: thread.id,
        subject: thread.subject,
        snippet: thread.snippet,
        latestMessageAt: thread.latestMessageAt,
        isUnread: thread.isUnread,
        labelIds: thread.labelIds,
      },
      update: {
        subject: thread.subject,
        snippet: thread.snippet,
        latestMessageAt: thread.latestMessageAt,
        isUnread: thread.isUnread,
        labelIds: thread.labelIds,
      },
    });
    for (const message of thread.messages) {
      const stored = await tx.emailMessage.upsert({
        where: {
          threadId_gmailMessageId: {
            threadId: saved.id,
            gmailMessageId: message.id,
          },
        },
        create: {
          threadId: saved.id,
          gmailMessageId: message.id,
          internetMessageId: message.internetMessageId,
          fromAddress: message.fromAddress,
          toAddresses: message.toAddresses,
          ccAddresses: message.ccAddresses,
          sentAt: message.sentAt,
          snippet: message.snippet,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          headers: message.headers,
        },
        update: {
          internetMessageId: message.internetMessageId,
          fromAddress: message.fromAddress,
          toAddresses: message.toAddresses,
          ccAddresses: message.ccAddresses,
          sentAt: message.sentAt,
          snippet: message.snippet,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          headers: message.headers,
        },
      });
      for (const attachment of message.attachments)
        await tx.attachment.upsert({
          where: {
            messageId_gmailAttachmentId: {
              messageId: stored.id,
              gmailAttachmentId: attachment.id,
            },
          },
          create: {
            messageId: stored.id,
            gmailAttachmentId: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.size,
            contentId: attachment.contentId,
          },
          update: {
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.size,
            contentId: attachment.contentId,
          },
        });
    }
  });
  return raw.historyId ?? undefined;
}

async function fullSync(
  connection: GmailConnection,
  mode: SyncResult["mode"],
): Promise<SyncResult> {
  const gmail = await getGmailService(connection.id);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail.users.threads.list({
      userId: "me",
      q: "in:inbox newer_than:14d",
      maxResults: Math.min(100, 200 - ids.length),
      pageToken,
    });
    ids.push(
      ...(page.data.threads ?? []).flatMap((thread) =>
        thread.id ? [thread.id] : [],
      ),
    );
    pageToken = page.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < 200);
  let historyId: string | undefined;
  for (const id of ids.slice(0, 200))
    historyId =
      (await saveThread(
        connection,
        (await gmail.users.threads.get({ userId: "me", id, format: "full" }))
          .data,
      )) ?? historyId;
  if (!historyId)
    historyId =
      (await gmail.users.getProfile({ userId: "me" })).data.historyId ??
      undefined;
  await db.syncState.update({
    where: { gmailConnectionId: connection.id },
    data: { historyId, pageToken: null },
  });
  return { mode, threads: ids.length, historyId };
}

export async function syncConnection(
  connectionId: string,
  forceFull = false,
): Promise<SyncResult> {
  const connection = await db.gmailConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { syncState: true },
  });
  if (connection.status !== "ACTIVE")
    throw new Error("Gmail connection is not active");
  await db.syncState.update({
    where: { gmailConnectionId: connection.id },
    data: { status: "RUNNING", lastStartedAt: new Date(), lastError: null },
  });
  await db.auditEvent.create({
    data: {
      tenantId: connection.tenantId,
      action: "SYNC_STARTED",
      targetType: "GmailConnection",
      targetId: connection.id,
    },
  });
  try {
    let result: SyncResult;
    if (forceFull || !connection.syncState?.historyId)
      result = await fullSync(connection, "initial");
    else {
      const gmail = await getGmailService(connection.id);
      try {
        const threadIds = new Set<string>();
        let pageToken: string | undefined;
        let historyId = connection.syncState.historyId;
        do {
          const page = await gmail.users.history.list({
            userId: "me",
            startHistoryId: connection.syncState.historyId,
            historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
            pageToken,
            maxResults: 100,
          });
          for (const h of page.data.history ?? [])
            for (const m of [
              ...(h.messagesAdded ?? []),
              ...(h.labelsAdded ?? []),
              ...(h.labelsRemoved ?? []),
            ])
              if (m.message?.threadId) threadIds.add(m.message.threadId);
          historyId = page.data.historyId ?? historyId;
          pageToken = page.data.nextPageToken ?? undefined;
        } while (pageToken && threadIds.size <= 200);
        for (const id of [...threadIds].slice(0, 200))
          await saveThread(
            connection,
            (
              await gmail.users.threads.get({
                userId: "me",
                id,
                format: "full",
              })
            ).data,
          );
        await db.syncState.update({
          where: { gmailConnectionId: connection.id },
          data: { historyId },
        });
        result = {
          mode: "incremental",
          threads: Math.min(threadIds.size, 200),
          historyId,
        };
      } catch (error) {
        if (!isGmailHistoryExpired(error)) throw error;
        result = await fullSync(connection, "bounded-resync");
      }
    }
    await db.syncState.update({
      where: { gmailConnectionId: connection.id },
      data: { status: "IDLE", lastCompletedAt: new Date(), lastError: null },
    });
    await db.auditEvent.create({
      data: {
        tenantId: connection.tenantId,
        action: "SYNC_COMPLETED",
        targetType: "GmailConnection",
        targetId: connection.id,
        metadata: result,
      },
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync failure";
    await db.syncState.update({
      where: { gmailConnectionId: connection.id },
      data: { status: "FAILED", lastError: message },
    });
    throw error;
  }
}
