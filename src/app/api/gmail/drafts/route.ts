import { NextResponse } from "next/server";
import { fetchAuthMutation } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";

export async function POST(request: Request) {
  const { draftId } = (await request.json()) as { draftId?: string };
  if (!draftId)
    return NextResponse.json({ error: "draftId required" }, { status: 400 });
  const job = await fetchAuthMutation(convexApi.jobs.enqueue, {
    kind: "gmail.draft.create",
    input: { draftId },
    dedupeKey: draftId,
  });
  return NextResponse.json(
    { jobId: job.id, status: job.status },
    { status: 202 },
  );
}
