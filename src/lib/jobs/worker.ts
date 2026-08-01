import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { createGmailDraft } from "@/lib/gmail/drafts";
import { syncConnection } from "@/lib/gmail/sync";
import { enqueueSync, queue, QUEUES, type QueueName } from "@/lib/jobs/queues";
import { analyzeThread, generateReplies } from "@/lib/ai/service";
import { runRetentionCleanup } from "@/lib/retention";
import { sendPushToUser } from "@/lib/push";
import { enqueueOperationalJob } from "@/lib/jobs/queues";

const connection = {
  url: getServerEnv().REDIS_URL,
  maxRetriesPerRequest: null,
};
const workerId = randomUUID();

async function execute(job: Job, handler: () => Promise<unknown>) {
  const id = job.data.operationalJobId as string | undefined;
  if (!id) return handler();
  const leased = await db.processingJob.updateMany({
    where: {
      id,
      status: { in: ["PENDING", "FAILED"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    },
    data: {
      status: "RUNNING",
      leaseOwner: workerId,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      startedAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  if (!leased.count) return { deduplicated: true };
  try {
    const output = await handler();
    await db.processingJob.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        output: (output ?? {}) as object,
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return output;
  } catch (error) {
    const current = await db.processingJob.findUniqueOrThrow({ where: { id } });
    const exhausted = current.attempts >= current.maxAttempts;
    await db.processingJob.update({
      where: { id },
      data: {
        status: exhausted ? "DEAD_LETTER" : "FAILED",
        error: error instanceof Error ? error.message : String(error),
        completedAt: exhausted ? new Date() : null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    throw error;
  }
}

async function processReminder(reminderId: string) {
  const reminder = await db.followUpReminder.findUnique({
    where: { id: reminderId },
  });
  if (!reminder || reminder.status === "DONE") return { skipped: true };
  if (reminder.dueAt.getTime() > Date.now())
    throw new Error("Reminder ran before due time");
  const notification = await db.notification.create({
    data: {
      userId: reminder.userId,
      threadId: reminder.threadId,
      kind: "FOLLOW_UP",
      title: reminder.title,
      body: reminder.note ?? "Follow-up reminder is due.",
    },
  });
  const membership = await db.membership.findFirst({
    where: { userId: reminder.userId },
  });
  if (membership)
    await enqueueOperationalJob(
      QUEUES.push,
      membership.tenantId,
      "notification.push",
      { notificationId: notification.id },
      notification.id,
    );
  return { notificationId: notification.id };
}

async function processPush(notificationId: string) {
  const notification = await db.notification.findUniqueOrThrow({
    where: { id: notificationId },
  });
  return sendPushToUser(notification.userId, {
    title: notification.title,
    body: notification.body,
    url: notification.threadId
      ? `/inbox/${notification.threadId}`
      : "/notifications",
  });
}
export function startWorkers() {
  const workers: Worker[] = [];
  const create = (
    name: QueueName,
    processor: (job: Job) => Promise<unknown>,
  ) => {
    const worker = new Worker(name, processor, {
      connection,
      concurrency: name === QUEUES.sync ? 2 : 5,
    });
    worker.on("error", (error) => console.error(`[${name}]`, error));
    workers.push(worker);
  };
  create(QUEUES.sync, async (job) => {
    if (job.name === "gmail.poll") {
      const connectionRow = await db.gmailConnection.findUnique({
        where: { id: job.data.connectionId as string },
      });
      return connectionRow?.status === "ACTIVE"
        ? enqueueSync(connectionRow)
        : { skipped: true };
    }
    return execute(job, () =>
      syncConnection(
        job.data.connectionId as string,
        Boolean(job.data.forceFull),
      ),
    );
  });
  create(QUEUES.drafts, (job) =>
    execute(job, () => createGmailDraft(job.data.draftId as string)),
  );
  create(QUEUES.analysis, (job) =>
    execute(job, () => {
      if (job.name === "ai.thread.analyze")
        return analyzeThread(job.data.threadId as string);
      throw new Error(`Unknown analysis job: ${job.name}`);
    }),
  );
  create(QUEUES.replies, (job) =>
    execute(job, () => {
      if (job.name !== "ai.reply.generate")
        throw new Error(`Unknown reply generation job: ${job.name}`);
      const request = { ...job.data };
      const actorId = request.actorId as string;
      delete request.actorId;
      delete request.operationalJobId;
      return generateReplies(request, actorId);
    }),
  );
  create(QUEUES.reminders, (job) =>
    execute(job, () => {
      if (job.name !== "reminder.due")
        throw new Error(`Unknown reminder job: ${job.name}`);
      return processReminder(job.data.reminderId as string);
    }),
  );
  create(QUEUES.push, (job) =>
    execute(job, () => {
      if (job.name !== "notification.push")
        throw new Error(`Unknown push job: ${job.name}`);
      return processPush(job.data.notificationId as string);
    }),
  );
  create(QUEUES.retention, (job) => execute(job, () => runRetentionCleanup()));
  void queueRetentionCleanup().catch((error) =>
    console.error("[retention-scheduler]", error),
  );
  return workers;
}

async function queueRetentionCleanup() {
  await queue(QUEUES.retention).upsertJobScheduler(
    "daily-retention-cleanup",
    { pattern: "17 3 * * *" },
    { name: "privacy.retention.cleanup", data: {} },
  );
}
