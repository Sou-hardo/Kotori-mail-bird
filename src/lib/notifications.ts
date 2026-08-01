import type { NotificationKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { enqueueOperationalJob, QUEUES } from "@/lib/jobs/queues";

export async function createNotification(input: {
  tenantId: string;
  userId: string;
  threadId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
}) {
  const notification = await db.notification.create({
    data: {
      userId: input.userId,
      threadId: input.threadId,
      kind: input.kind,
      title: input.title,
      body: input.body,
    },
  });
  await enqueueOperationalJob(
    QUEUES.push,
    input.tenantId,
    "notification.push",
    { notificationId: notification.id },
    notification.id,
  );
  return notification;
}
