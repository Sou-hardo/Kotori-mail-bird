import type { TenantRole } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  ForbiddenError,
  requireUserId,
  type TenantPrincipal,
} from "@/lib/auth/tenant-primitives";

export * from "@/lib/auth/tenant-primitives";

export async function requireTenantMembership(
  principal: TenantPrincipal,
  tenantId: string,
  allowedRoles?: readonly TenantRole[],
) {
  const userId = requireUserId(principal);
  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
  });
  if (
    !membership ||
    (allowedRoles && !allowedRoles.includes(membership.role))
  ) {
    throw new ForbiddenError();
  }
  return membership;
}
