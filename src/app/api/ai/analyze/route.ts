import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { analysisSchema, convexIdSchema } from "@/lib/ai/schemas";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";

const requestSchema = z.object({ threadId: convexIdSchema }).strict();

export async function POST(request: Request) {
  let threadId;
  try {
    ({ threadId } = requestSchema.parse(await request.json()));
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: "invalid_request", issues: error.issues },
        { status: 400 },
      );
    throw error;
  }
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
