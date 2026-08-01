import { NextResponse } from "next/server";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { enqueueSync } from "@/lib/jobs/queues";

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
  const connection = await db.gmailConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  await requireCurrentTenant(connection.tenantId);
  const job = await enqueueSync(connection, full);
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
  const connection = await db.gmailConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { syncState: true },
  });
  await requireCurrentTenant(connection.tenantId);
  const latestJobs = await db.processingJob.findMany({
    where: {
      tenantId: connection.tenantId,
      kind: "gmail.sync",
      input: { path: ["connectionId"], equals: connection.id },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return NextResponse.json({
    connection: {
      id: connection.id,
      emailAddress: connection.emailAddress,
      status: connection.status,
      lastError: connection.lastError,
    },
    sync: connection.syncState,
    jobs: latestJobs,
  });
}
