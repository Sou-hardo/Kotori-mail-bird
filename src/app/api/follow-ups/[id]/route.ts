import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { enqueueOperationalJob, QUEUES } from "@/lib/jobs/queues";
export async function PATCH(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId, tenantId } = await requireCurrentTenant();
  const { id } = await params;
  const input = z
    .object({
      title: z.string().min(1).optional(),
      note: z.string().optional(),
      dueAt: z.coerce.date().optional(),
      status: z.enum(["OPEN", "SNOOZED", "DONE"]).optional(),
    })
    .parse(await r.json());
  const result = await db.followUpReminder.updateMany({
    where: { id, userId },
    data: input,
  });
  const reminder = await db.followUpReminder.findFirst({
    where: { id, userId },
  });
  if (reminder && reminder.status !== "DONE")
    await enqueueOperationalJob(
      QUEUES.reminders,
      tenantId,
      "reminder.due",
      { reminderId: reminder.id },
      `${reminder.id}:${reminder.updatedAt.toISOString()}`,
      { delay: Math.max(0, reminder.dueAt.getTime() - Date.now()) },
    );
  return NextResponse.json(result);
}
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await requireCurrentTenant();
  const { id } = await params;
  await db.followUpReminder.deleteMany({ where: { id, userId } });
  return new NextResponse(null, { status: 204 });
}
