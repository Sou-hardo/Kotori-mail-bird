import { db } from "@/lib/db";

const DAY_MS = 86_400_000;

export async function runRetentionCleanup(now = new Date()) {
  const emailCutoff = new Date(now.getTime() - 90 * DAY_MS);
  const auditCutoff = new Date(now.getTime() - 365 * DAY_MS);

  return db.$transaction(async (tx) => {
    const emailThreads = await tx.emailThread.deleteMany({
      where: { latestMessageAt: { lt: emailCutoff } },
    });
    const auditEvents = await tx.auditEvent.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    });
    const operationalJobs = await tx.processingJob.deleteMany({
      where: {
        completedAt: { lt: emailCutoff },
        status: { in: ["SUCCEEDED", "CANCELLED"] },
      },
    });

    return {
      emailThreads: emailThreads.count,
      auditEvents: auditEvents.count,
      operationalJobs: operationalJobs.count,
    };
  });
}
