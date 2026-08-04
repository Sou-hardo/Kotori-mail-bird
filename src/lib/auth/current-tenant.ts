import { fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../convex/_generated/api";

export async function requireCurrentTenant(tenantId?: string) {
  return fetchAuthQuery(api.domain.currentPrincipal, { tenantId });
}
