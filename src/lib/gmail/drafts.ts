import { db } from "@/lib/db";
import { getGmailService } from "@/lib/gmail/service";
import { createReplyMime } from "@/lib/gmail/mime";

export async function createGmailDraft(draftId: string) {
  const draft = await db.gmailDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: {
      thread: {
        include: {
          gmailConnection: true,
          messages: { orderBy: { sentAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (draft.gmailDraftId) return draft;
  const original = draft.thread.messages[0];
  if (!original) throw new Error("Cannot reply to an empty thread");
  const gmail = await getGmailService(draft.thread.gmailConnectionId);
  const raw = createReplyMime(
    {
      subject: draft.thread.subject,
      fromAddress: original.fromAddress,
      toAddresses: original.toAddresses,
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
