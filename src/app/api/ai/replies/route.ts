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

export async function POST(request: Request) {
  const input = replyRequestSchema.parse(await request.json());
  const thread = await db.emailThread.findUniqueOrThrow({
    where: { id: input.threadId },
    include: { messages: { include: { attachments: true } } },
  });
  const principal = await requireCurrentTenant(thread.tenantId);
  const flags = detectReviewFlags(thread);
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
