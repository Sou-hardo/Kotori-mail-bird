import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import type { GmailConnection } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { operationalDedupeId } from "@/lib/jobs/dedupe";

export const QUEUES = {
  sync: "gmail-sync",
  analysis: "analysis",
  replies: "reply-generation",
  drafts: "drafts",
  reminders: "reminders",
  push: "push",
  retention: "retention",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
const connection = {
  url: getServerEnv().REDIS_URL,
  maxRetriesPerRequest: null,
};
const instances = new Map<string, Queue>();
export function queue(name: QueueName) {
  let value = instances.get(name);
  if (!value) {
    value = new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
    instances.set(name, value);
  }
  return value;
}

export async function enqueueOperationalJob(
  name: QueueName,
  tenantId: string,
  kind: string,
  input: Record<string, unknown>,
  dedupeKey: string,
  options?: { delay?: number },
) {
  const record = await db.processingJob.upsert({
    where: { tenantId_kind_dedupeKey: { tenantId, kind, dedupeKey } },
    create: {
      tenantId,
      kind,
      dedupeKey,
      input: input as Prisma.InputJsonValue,
      scheduledAt: new Date(Date.now() + (options?.delay ?? 0)),
    },
    update: {},
  });
  if (record.status !== "PENDING") return record;
  const job = await queue(name).add(
    kind,
    { ...input, operationalJobId: record.id },
    {
      jobId: operationalDedupeId(tenantId, kind, dedupeKey),
      delay: options?.delay,
    },
  );
  return db.processingJob.update({
    where: { id: record.id },
    data: { queueJobId: job.id },
  });
}

export async function enqueueSync(
  connection: Pick<GmailConnection, "id" | "tenantId">,
  forceFull = false,
) {
  const bucket = forceFull
    ? "initial"
    : String(Math.floor(Date.now() / 300_000));
  const record = await enqueueOperationalJob(
    QUEUES.sync,
    connection.tenantId,
    "gmail.sync",
    { connectionId: connection.id, forceFull },
    `${connection.id}:${bucket}`,
  );
  await queue(QUEUES.sync).upsertJobScheduler(
    `poll-${connection.id}`,
    { every: 300_000 },
    {
      name: "gmail.poll",
      data: { connectionId: connection.id, tenantId: connection.tenantId },
    },
  );
  return record;
}

export function enqueueAnalysis(
  tenantId: string,
  threadId: string,
  version = "manual",
) {
  return enqueueOperationalJob(
    QUEUES.analysis,
    tenantId,
    "ai.thread.analyze",
    { threadId, version },
    `${threadId}:${version}`,
  );
}

export function enqueueReplyGeneration(
  tenantId: string,
  input: Record<string, unknown>,
  actorId: string,
) {
  const threadId = String(input.threadId);
  return enqueueOperationalJob(
    QUEUES.replies,
    tenantId,
    "ai.reply.generate",
    { ...input, actorId },
    `${threadId}:${randomUUID()}`,
  );
}

export async function closeQueues() {
  await Promise.all([...instances.values()].map((item) => item.close()));
  instances.clear();
}
