import { NextResponse } from "next/server";
import { replyRequestSchema } from "@/lib/ai/schemas";
import {
  detectReviewFlags,
  ReviewRequiredError,
  assertReviewAcknowledged,
} from "@/lib/ai/safety";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { latestInbound, replyAllRecipients } from "@/lib/gmail/recipients";

export async function POST(request: Request) {
  const input = replyRequestSchema.parse(await request.json());
  const thread = await fetchAuthQuery(convexApi.domain.getThread, {
    id: input.threadId,
  });
  if (!thread)
    return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  const identity = thread.identities.find(
    (x: { id: string }) => x.id === input.identityId,
  );
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
  const principal = await fetchAuthQuery(convexApi.domain.currentPrincipal, {});
  const job = await fetchAuthMutation(convexApi.jobs.enqueue, {
    kind: "ai.reply.generate",
    input: { ...input, actorId: principal.userId },
    dedupeKey: `${input.threadId}:${crypto.randomUUID()}`,
  });
  return NextResponse.json(
    { jobId: job.id, status: job.status, requiredReviewFlags: flags },
    { status: 202 },
  );
}

const terminalFailureStatuses = new Set(["FAILED", "DEAD_LETTER", "CANCELLED"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");
  const threadId = searchParams.get("threadId");
  if (!jobId || !threadId)
    return NextResponse.json(
      { error: "jobId_and_threadId_required" },
      { status: 400 },
    );

  const job = await fetchAuthQuery(convexApi.jobs.result, { jobId, threadId });
  if (!job)
    return NextResponse.json({ error: "job_not_found" }, { status: 404 });

  if (job.status !== "SUCCEEDED")
    return NextResponse.json(
      {
        status: job.status,
        ...(terminalFailureStatuses.has(job.status)
          ? { error: job.error ?? "generation_failed" }
          : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );

  return NextResponse.json(
    {
      status: job.status,
      options: job.options ?? [],
      requiredReviewFlags: job.requiredReviewFlags ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
