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
  return { id: record.id, analysis, safetyFlags };
}

export async function generateReplies(rawRequest: unknown, actorId?: string) {
  const request = replyRequestSchema.parse(rawRequest);
  const thread = await loadThread(request.threadId);
  const safetyFlags = detectReviewFlags(thread);
  assertReviewAcknowledged(safetyFlags, request.acknowledgements);
  const latest = await db.threadAnalysis.findFirst({
    where: { threadId: thread.id, schemaVersion: AI_SCHEMA_VERSION },
    orderBy: { createdAt: "desc" },
  });
  const analysis = latest
    ? analysisSchema.parse(latest.analysis)
    : (await analyzeThread(thread.id)).analysis;
  const prompt = replyPrompt(thread, analysis, request);
  const output = await deepSeekJson(
    prompt.system,
    prompt.user,
    replyOutputSchema,
  );
  // Validate a second time immediately before persistence/display boundaries.
  const validated = replyOutputSchema.parse(output);
  const generation = await db.$transaction(async (tx) => {
    const created = await tx.replyGeneration.create({
      data: {
        threadId: thread.id,
        schemaVersion: AI_SCHEMA_VERSION,
        model: getServerEnv().DEEPSEEK_MODEL,
        intent: request.intent,
        tone: request.tone,
        length: request.length,
        identity: request.identity,
        closing: request.closing,
        requiredReviewFlags: safetyFlags,
        acknowledgedFlags: request.acknowledgements,
      },
    });
    await tx.replyOption.createMany({
      data: validated.drafts.map((draft, index) => ({
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
            identity: request.identity,
            closing: request.closing,
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
  return replyOutputSchema.parse({
    schemaVersion: generation.schemaVersion,
    drafts: options.map((option) => ({
      label: validated.drafts[option.rank - 1].label,
      body: option.body,
    })),
  });
}
