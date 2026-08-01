import { NextResponse } from "next/server";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { revokeConnection } from "@/lib/gmail/connection";

export async function POST(request: Request) {
  const { connectionId } = (await request.json()) as { connectionId?: string };
  if (!connectionId)
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 },
    );
  const connection = await db.gmailConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  const principal = await requireCurrentTenant(connection.tenantId);
  await revokeConnection(connection.id);
  await db.auditEvent.create({
    data: {
      tenantId: connection.tenantId,
      actorId: principal.userId,
      action: "CONNECTION_REVOKED",
      targetType: "GmailConnection",
      targetId: connection.id,
    },
  });
  return NextResponse.json({ status: "revoked" });
}
