import { NextResponse } from "next/server";
import { z } from "zod";
import { analysisSchema } from "@/lib/ai/schemas";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { enqueueAnalysis } from "@/lib/jobs/queues";

const requestSchema = z.object({ threadId: z.string().cuid() }).strict();

export async function POST(request: Request) {
  const { threadId } = requestSchema.parse(await request.json());
  const thread = await db.emailThread.findUniqueOrThrow({
    where: { id: threadId },
  });
  await requireCurrentTenant(thread.tenantId);
  const job = await enqueueAnalysis(thread.tenantId, threadId);
  return NextResponse.json(
    { jobId: job.id, status: job.status },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("threadId");
  if (!threadId)
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  const thread = await db.emailThread.findUniqueOrThrow({
    where: { id: threadId },
  });
  await requireCurrentTenant(thread.tenantId);
  const row = await db.threadAnalysis.findFirst({
    where: { threadId },
    orderBy: { createdAt: "desc" },
  });
  if (!row)
    return NextResponse.json({ error: "analysis not found" }, { status: 404 });
  return NextResponse.json({
    id: row.id,
    createdAt: row.createdAt,
    analysis: analysisSchema.parse(row.analysis),
    safetyFlags: row.safetyFlags,
  });
}
