import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { createGmailDraft } from "@/lib/gmail/drafts";
import { syncConnection } from "@/lib/gmail/sync";
import { enqueueSync, QUEUES, type QueueName } from "@/lib/jobs/queues";

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

const placeholder = (kind: string) => async () => ({ kind, placeholder: true });
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
  create(QUEUES.analysis, (job) => execute(job, placeholder("analysis")));
  create(QUEUES.reminders, (job) => execute(job, placeholder("reminders")));
  create(QUEUES.push, (job) => execute(job, placeholder("push")));
  create(QUEUES.retention, (job) =>
    execute(job, async () => {
      const cutoff = new Date(Date.now() - 90 * 86400_000);
      return db.processingJob.deleteMany({
        where: {
          completedAt: { lt: cutoff },
          status: { in: ["SUCCEEDED", "CANCELLED"] },
        },
      });
    }),
  );
  return workers;
}
