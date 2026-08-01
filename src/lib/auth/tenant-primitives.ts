export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Tenant access denied") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type TenantPrincipal = { user?: { id?: string | null } } | null;

export function requireUserId(principal: TenantPrincipal): string {
  const userId = principal?.user?.id;
  if (!userId) throw new UnauthorizedError();
  return userId;
}

export function tenantWhere<T extends object>(tenantId: string, where?: T) {
  return { ...where, tenantId } as T & { tenantId: string };
}
