import type { Prisma } from "@/generated/prisma/client";
import { analysisPrompt, replyPrompt } from "@/lib/ai/prompts";
import { deepSeekJson } from "@/lib/ai/deepseek";
import {
  AI_SCHEMA_VERSION,
  analysisSchema,
  replyOutputSchema,
  replyRequestSchema,
} from "@/lib/ai/schemas";
import { assertReviewAcknowledged, detectReviewFlags } from "@/lib/ai/safety";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { latestInbound, replyAllRecipients } from "@/lib/gmail/recipients";
import { createNotification } from "@/lib/notifications";

async function loadThread(threadId: string) {
  return db.emailThread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      messages: { orderBy: { sentAt: "asc" }, include: { attachments: true } },
    },
  });
}

export async function analyzeThread(threadId: string) {
  const thread = await loadThread(threadId);
  const safetyFlags = detectReviewFlags(thread);
  const prompt = analysisPrompt(thread);
  const analysis = await deepSeekJson(
    prompt.system,
    prompt.user,
    analysisSchema,
  );
  const model = getServerEnv().DEEPSEEK_MODEL;
  const record = await db.$transaction(async (tx) => {
    const created = await tx.threadAnalysis.create({
      data: {
        threadId,
        schemaVersion: AI_SCHEMA_VERSION,
        model,
        analysis: analysis as unknown as Prisma.InputJsonValue,
        safetyFlags,
      },
    });
    await tx.classification.upsert({
      where: { threadId },
      create: {
        threadId,
        category: analysis.category,
        confidence: analysis.confidence,
        rationale: analysis.reviewReasons.join("; "),
        model,
      },
      update: {
        category: analysis.category,
        confidence: analysis.confidence,
        rationale: analysis.reviewReasons.join("; "),
        model,
      },
    });
    await tx.threadSummary.upsert({
      where: { threadId },
      create: {
        threadId,
        summary: analysis.summary,
        requestedActions: analysis.actions,
        model,
      },
      update: {
        summary: analysis.summary,
        requestedActions: analysis.actions,
        model,
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: thread.tenantId,
        action: "CLASSIFICATION_CREATED",
        targetType: "ThreadAnalysis",
        targetId: created.id,
        metadata: { schemaVersion: AI_SCHEMA_VERSION, safetyFlags },
      },
    });
    return created;
  });
  if (analysis.category === "ACTION_REQUIRED") {
    const memberships = await db.membership.findMany({
      where: { tenantId: thread.tenantId },
      select: { userId: true },
    });
    await Promise.all(
      memberships.map(({ userId }) =>
        createNotification({
          tenantId: thread.tenantId,
          userId,
          threadId: thread.id,
          kind: "ATTENTION",
          title: thread.subject ?? "Message needs attention",
          body: analysis.summary,
        }),
      ),
    );
  }
  return { id: record.id, analysis, safetyFlags };
}

export async function generateReplies(rawRequest: unknown, actorId?: string) {
  const request = replyRequestSchema.parse(rawRequest);
  if (!actorId) throw new Error("Authenticated actor required");
  const thread = await loadThread(request.threadId);
  const [identity, connection] = await Promise.all([
    db.identityProfile.findFirst({
      where: { id: request.identityId, userId: actorId },
    }),
    db.gmailConnection.findUniqueOrThrow({
      where: { id: thread.gmailConnectionId },
    }),
  ]);
  if (!identity)
    throw new Error("Identity profile not found or not authorized");
  const inbound = latestInbound(thread.messages, connection.emailAddress);
  const envelope = inbound
    ? replyAllRecipients(inbound, connection.emailAddress)
    : null;
  if (!envelope?.to.length) throw new Error("No non-owner reply recipient");
  const identityText = [
    identity.displayName,
    identity.role,
    identity.company,
    identity.email,
  ]
    .filter(Boolean)
    .join(", ");
  const safetyFlags = detectReviewFlags(thread, {
    intent: request.intent,
    identity: identityText,
    closing: identity.closing,
    recipients: [...envelope.to, ...envelope.cc],
  });
  assertReviewAcknowledged(safetyFlags, request.acknowledgements);
  const latest = await db.threadAnalysis.findFirst({
    where: { threadId: thread.id, schemaVersion: AI_SCHEMA_VERSION },
    orderBy: { createdAt: "desc" },
  });
  const analysis = latest
    ? analysisSchema.parse(latest.analysis)
    : (await analyzeThread(thread.id)).analysis;
  const trustedRequest = {
    ...request,
    identity: identityText,
    closing: identity.closing,
    signature: identity.signature,
  };
  const prompt = replyPrompt(thread, analysis, trustedRequest);
  const output = await deepSeekJson(
    prompt.system,
    prompt.user,
    replyOutputSchema,
  );
  // Validate a second time immediately before persistence/display boundaries.
  const validated = replyOutputSchema.parse(output);
  const finalized = validated.drafts.map((draft) => ({
    ...draft,
    body: `${draft.body.trim()}\n\n${identity.closing}\n${identity.signature}`,
  }));
  const finalFlags = [
    ...new Set(
      finalized.flatMap((draft) =>
        detectReviewFlags(thread, {
          body: draft.body,
          intent: request.intent,
          identity: identityText,
          closing: identity.closing,
          recipients: [...envelope.to, ...envelope.cc],
        }),
      ),
    ),
  ];
  const generation = await db.$transaction(async (tx) => {
    const created = await tx.replyGeneration.create({
      data: {
        threadId: thread.id,
        schemaVersion: AI_SCHEMA_VERSION,
        model: getServerEnv().DEEPSEEK_MODEL,
        intent: request.intent,
        tone: request.tone,
        length: request.length,
        identity: `${identity.displayName} <${identity.email}>`,
        closing: identity.closing,
        requiredReviewFlags: finalFlags,
        acknowledgedFlags: request.acknowledgements,
      },
    });
    await tx.replyOption.createMany({
      data: finalized.map((draft, index) => ({
        threadId: thread.id,
        generationId: created.id,
        intent: request.intent,
        tone: request.tone,
        body: draft.body,
        model: getServerEnv().DEEPSEEK_MODEL,
        rank: index + 1,
      })),
    });
    await tx.auditEvent.create({
      data: {
        tenantId: thread.tenantId,
        actorId,
        action: "REPLY_GENERATED",
        targetType: "ReplyGeneration",
        targetId: created.id,
        metadata: {
          schemaVersion: AI_SCHEMA_VERSION,
          safetyFlags,
          preferences: {
            intent: request.intent,
            tone: request.tone,
            length: request.length,
            identityId: identity.id,
            closing: identity.closing,
          },
        },
      },
    });
    return created;
  });
  const options = await db.replyOption.findMany({
    where: { generationId: generation.id },
    orderBy: { rank: "asc" },
  });
  await createNotification({
    tenantId: thread.tenantId,
    userId: actorId,
    threadId: thread.id,
    kind: "DRAFT_READY",
    title: "Reply options ready",
    body: thread.subject ?? "Three reply options are ready for review.",
  });
  return replyOutputSchema.parse({
    schemaVersion: generation.schemaVersion,
    drafts: options.map((option) => ({
      label: finalized[option.rank - 1]!.label,
      body: option.body,
    })),
  });
}
