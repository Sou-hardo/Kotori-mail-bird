/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_FLAGS, detectReviewFlags } from "@/lib/ai/safety";
import { sanitizeAiText } from "@/lib/ai/sanitize";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { latestInbound, replyAllRecipients } from "@/lib/gmail/recipients";

const actionSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("edit"), body: z.string().min(1).max(20_000) })
    .strict(),
  z
    .object({
      action: z.literal("reject"),
      reason: z.string().max(1_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      acknowledgements: z.array(z.enum(REVIEW_FLAGS)).default([]),
    })
    .strict(),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const input = actionSchema.parse(await request.json());
  const inbox = await fetchAuthQuery(convexApi.domain.listInbox, {});
  let option: any, thread: any;
  for (const candidate of inbox) {
    const full = await fetchAuthQuery(convexApi.domain.getThread, {
      id: candidate.id,
    });
    const found = full?.replyGenerations?.[0]?.options?.find(
      (x: any) => x.id === id,
    );
    if (found) {
      option = found;
      thread = full;
      break;
    }
  }
  if (!option)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  option.thread = thread;
  option.generation = thread.replyGenerations?.[0];
  const inbound = latestInbound(
    option.thread.messages,
    option.thread.gmailConnection.emailAddress,
  );
  const recipients = inbound
    ? replyAllRecipients(inbound, option.thread.gmailConnection.emailAddress)
    : null;
  if (!inbound || !recipients?.to.length)
    return NextResponse.json({ error: "no_reply_recipient" }, { status: 409 });
  const currentFlags = detectReviewFlags(option.thread, {
    body: option.body,
    intent: option.intent,
    identity: option.generation?.identity,
    closing: option.generation?.closing,
    recipients: [...recipients.to, ...recipients.cc],
  });
  if (input.action === "approve") {
    const missing = currentFlags.filter(
      (flag) =>
        !input.acknowledgements.includes(flag as (typeof REVIEW_FLAGS)[number]),
    );
    if (missing.length)
      return NextResponse.json(
        { error: "review_acknowledgement_required", flags: missing },
        { status: 409 },
      );
  }
  const result = await fetchAuthMutation(convexApi.domain.replyAction, {
    id,
    action: input.action,
    body: input.action === "edit" ? sanitizeAiText(input.body) : undefined,
    reason: input.action === "reject" ? input.reason : undefined,
    acknowledgements:
      input.action === "approve" ? input.acknowledgements : undefined,
  });
  return NextResponse.json({
    id: result.id,
    action: input.action,
    version: result.version,
    requiredReviewFlags:
      input.action === "edit"
        ? detectReviewFlags(option.thread, {
            body: result.body,
            intent: option.intent,
            identity: option.generation?.identity,
            closing: option.generation?.closing,
            recipients: [...recipients.to, ...recipients.cc],
          })
        : currentFlags,
  });
}
