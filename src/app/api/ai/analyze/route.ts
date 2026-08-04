import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { analysisSchema, convexIdSchema } from "@/lib/ai/schemas";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";

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
  const job = await fetchAuthMutation(api.jobs.enqueue, {
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
  const row = await fetchAuthQuery(api.domain.latestAnalysis, {
    threadId,
  });
  if (!row)
    return NextResponse.json({ error: "analysis not found" }, { status: 404 });
  // Rows written before the analysisSchema rewire don't match the current
  // shape; fall back to the stored value as-is instead of 500ing old threads.
  const parsed = analysisSchema.safeParse(row.analysis);
  return NextResponse.json({
    id: row.id,
    createdAt: row.createdAt,
    analysis: parsed.success ? parsed.data : row.analysis,
    safetyFlags: row.safetyFlags,
  });
}
