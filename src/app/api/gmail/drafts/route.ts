import { NextResponse } from "next/server";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { enqueueOperationalJob, QUEUES } from "@/lib/jobs/queues";

export async function POST(request: Request) {
  const { draftId } = (await request.json()) as { draftId?: string };
  if (!draftId)
    return NextResponse.json({ error: "draftId required" }, { status: 400 });
  const draft = await db.gmailDraft.findUniqueOrThrow({
    where: { id: draftId },
    include: { thread: true },
  });
  await requireCurrentTenant(draft.thread.tenantId);
  const job = await enqueueOperationalJob(
    QUEUES.drafts,
    draft.thread.tenantId,
    "gmail.draft.create",
    { draftId },
    draftId,
  );
  return NextResponse.json(
    { jobId: job.id, status: job.status },
    { status: 202 },
  );
}
