import { NextResponse } from "next/server";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";

export async function POST(request: Request) {
  const { connectionId, full = false } = (await request.json()) as {
    connectionId?: string;
    full?: boolean;
  };
  if (!connectionId)
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 },
    );
  const bucket = full ? "initial" : String(Math.floor(Date.now() / 300_000));
  const job = await fetchAuthMutation(api.jobs.enqueue, {
    kind: "gmail.sync",
    input: { connectionId, forceFull: full },
    dedupeKey: `${connectionId}:${bucket}`,
  });
  return NextResponse.json(
    { jobId: job.id, status: job.status },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId)
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 },
    );
  return NextResponse.json(
    await fetchAuthQuery(api.jobs.status, { connectionId }),
  );
}
