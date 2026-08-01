import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { enqueueOperationalJob, QUEUES } from "@/lib/jobs/queues";
const schema = z.object({
  title: z.string().min(1),
  note: z.string().optional(),
  dueAt: z.coerce.date(),
  threadId: z.string().optional(),
});
export async function GET() {
  const { userId } = await requireCurrentTenant();
  return NextResponse.json(
    await db.followUpReminder.findMany({
      where: { userId },
      orderBy: { dueAt: "asc" },
    }),
  );
}
export async function POST(r: Request) {
  const input = schema.parse(await r.json());
  const { userId, tenantId } = await requireCurrentTenant();
  if (input.threadId) {
    const thread = await db.emailThread.findFirst({
      where: { id: input.threadId, tenantId },
      select: { id: true },
    });
    if (!thread)
      return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
  }
  const reminder = await db.followUpReminder.create({
    data: { ...input, userId },
  });
  await enqueueOperationalJob(
    QUEUES.reminders,
    tenantId,
    "reminder.due",
    { reminderId: reminder.id },
    `${reminder.id}:${reminder.updatedAt.toISOString()}`,
    { delay: Math.max(0, reminder.dueAt.getTime() - Date.now()) },
  );
  return NextResponse.json(reminder, { status: 201 });
}
