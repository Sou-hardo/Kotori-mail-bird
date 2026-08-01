import { NextResponse } from "next/server";
import { replyRequestSchema } from "@/lib/ai/schemas";
import {
  detectReviewFlags,
  ReviewRequiredError,
  assertReviewAcknowledged,
} from "@/lib/ai/safety";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { enqueueReplyGeneration } from "@/lib/jobs/queues";
import { latestInbound, replyAllRecipients } from "@/lib/gmail/recipients";

export async function POST(request: Request) {
  const input = replyRequestSchema.parse(await request.json());
  const thread = await db.emailThread.findUniqueOrThrow({
    where: { id: input.threadId },
    include: {
      gmailConnection: true,
      messages: { orderBy: { sentAt: "asc" }, include: { attachments: true } },
    },
  });
  const principal = await requireCurrentTenant(thread.tenantId);
  const identity = await db.identityProfile.findFirst({
    where: { id: input.identityId, userId: principal.userId },
  });
  if (!identity)
    return NextResponse.json({ error: "identity_not_found" }, { status: 403 });
  const inbound = latestInbound(
    thread.messages,
    thread.gmailConnection.emailAddress,
  );
  const recipients = inbound
    ? replyAllRecipients(inbound, thread.gmailConnection.emailAddress)
    : null;
  if (!recipients?.to.length)
    return NextResponse.json({ error: "no_reply_recipient" }, { status: 409 });
  const flags = detectReviewFlags(thread, {
    intent: input.intent,
    identity: `${identity.displayName} ${identity.email} ${identity.signature}`,
    closing: identity.closing,
    recipients: [...recipients.to, ...recipients.cc],
  });
  try {
    assertReviewAcknowledged(flags, input.acknowledgements);
  } catch (error) {
    if (error instanceof ReviewRequiredError)
      return NextResponse.json(
        { error: "review_acknowledgement_required", flags: error.flags },
        { status: 409 },
      );
    throw error;
  }
  const job = await enqueueReplyGeneration(
    thread.tenantId,
    input,
    principal.userId,
  );
  return NextResponse.json(
    { jobId: job.id, status: job.status, requiredReviewFlags: flags },
    { status: 202 },
  );
}
