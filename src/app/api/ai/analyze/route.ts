import { NextResponse } from "next/server";
import { z } from "zod";
import { analysisSchema } from "@/lib/ai/schemas";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";

const requestSchema = z.object({ threadId: z.string().cuid() }).strict();

export async function POST(request: Request) {
  const { threadId } = requestSchema.parse(await request.json());
  const job = await fetchAuthMutation(convexApi.jobs.enqueue, {
    kind: "ai.thread.analyze",
    input: { threadId, version: "manual" },
    dedupeKey: `${threadId}:manual`,
  });
  return NextResponse.json(
    { jobId: job.id, status: job.status },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("threadId");
  if (!threadId)
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  const row = await fetchAuthQuery(convexApi.domain.latestAnalysis, {
    threadId,
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
