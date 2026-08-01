import { NextResponse } from "next/server";
import { z } from "zod";
import { REVIEW_FLAGS } from "@/lib/ai/safety";
import { sanitizeAiText } from "@/lib/ai/sanitize";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";

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
  const option = await db.replyOption.findUniqueOrThrow({
    where: { id },
    include: { thread: true, generation: true },
  });
  const principal = await requireCurrentTenant(option.thread.tenantId);
  if (input.action === "approve") {
    const missing = (option.generation?.requiredReviewFlags ?? []).filter(
      (flag) =>
        !input.acknowledgements.includes(flag as (typeof REVIEW_FLAGS)[number]),
    );
    if (missing.length)
      return NextResponse.json(
        { error: "review_acknowledgement_required", flags: missing },
        { status: 409 },
      );
  }
  const result = await db.$transaction(async (tx) => {
    let target = option;
    if (input.action === "edit")
      target = await tx.replyOption.update({
        where: { id },
        data: { body: sanitizeAiText(input.body), version: { increment: 1 } },
      });
    if (input.action === "approve") {
      await tx.replyGeneration.update({
        where: { id: option.generationId! },
        data: { acknowledgedFlags: input.acknowledgements },
      });
      await tx.gmailDraft.create({
        data: {
          threadId: option.threadId,
          replyOptionId: option.id,
          body: option.body,
          status: "APPROVED",
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        tenantId: option.thread.tenantId,
        actorId: principal.userId,
        action:
          input.action === "edit"
            ? "REPLY_EDITED"
            : input.action === "reject"
              ? "REPLY_REJECTED"
              : "REPLY_APPROVED",
        targetType: "ReplyOption",
        targetId: id,
        metadata:
          input.action === "reject"
            ? {
                reason: sanitizeAiText(input.reason, 1_000),
                body: option.body,
                version: option.version,
              }
            : input.action === "approve"
              ? {
                  acknowledgements: input.acknowledgements,
                  body: option.body,
                  version: option.version,
                }
              : {
                  previousBody: option.body,
                  body: target.body,
                  version: target.version,
                },
      },
    });
    return target;
  });
  return NextResponse.json({
    id: result.id,
    action: input.action,
    version: result.version,
  });
}
