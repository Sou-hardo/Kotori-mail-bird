import { fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";

export async function requireCurrentTenant(tenantId?: string) {
  return fetchAuthQuery(convexApi.domain.currentPrincipal, { tenantId });
}
