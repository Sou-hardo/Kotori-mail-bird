import { db } from "@/lib/db";
import { getGmailService } from "@/lib/gmail/service";
import { createReplyMime } from "@/lib/gmail/mime";
import { latestInbound, replyAllRecipients } from "@/lib/gmail/recipients";

export async function createGmailDraft(draftId: string) {
  const draft = await db.gmailDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: {
      replyOption: { include: { generation: true } },
      thread: {
        include: {
          gmailConnection: true,
          messages: { orderBy: { sentAt: "asc" } },
        },
      },
    },
  });
  if (draft.gmailDraftId) return draft;
  const original =
    draft.thread.messages.find(
      (message) => message.id === draft.sourceMessageId,
    ) ??
    latestInbound(
      draft.thread.messages,
      draft.thread.gmailConnection.emailAddress,
    );
  if (!original) throw new Error("Cannot reply to an empty thread");
  const recipients = draft.toAddresses.length
    ? { to: draft.toAddresses, cc: draft.ccAddresses }
    : replyAllRecipients(original, draft.thread.gmailConnection.emailAddress);
  if (!recipients?.to.length) throw new Error("No non-owner reply recipient");
  const gmail = await getGmailService(draft.thread.gmailConnectionId);
  const raw = createReplyMime(
    {
      subject: draft.thread.subject,
      fromAddress:
        draft.replyOption?.generation?.identity ??
        draft.thread.gmailConnection.emailAddress,
      toAddresses: recipients.to,
      ccAddresses: recipients.cc,
      internetMessageId: original.internetMessageId,
      headers: original.headers,
    },
    draft.body,
  );
  const created = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { threadId: draft.thread.gmailThreadId, raw } },
  });
  if (!created.data.id) throw new Error("Gmail did not return a draft id");
  const result = await db.gmailDraft.update({
    where: { id: draft.id },
    data: { gmailDraftId: created.data.id, status: "CREATED_IN_GMAIL" },
  });
  await db.auditEvent.create({
    data: {
      tenantId: draft.thread.tenantId,
      action: "GMAIL_DRAFT_CREATED",
      targetType: "GmailDraft",
      targetId: draft.id,
    },
  });
  return result;
}
