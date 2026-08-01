import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function requireCurrentTenant(tenantId?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const membership = tenantId
    ? await db.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: session.user.id } },
      })
    : await db.membership.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: "asc" },
      });
  if (!membership) throw new Error("Forbidden");
  return { userId: session.user.id, tenantId: membership.tenantId };
}
