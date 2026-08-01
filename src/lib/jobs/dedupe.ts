import { createHash } from "node:crypto";

export function operationalDedupeId(
  tenantId: string,
  kind: string,
  dedupeKey: string,
) {
  return createHash("sha256")
    .update(`${tenantId}|${kind}|${dedupeKey}`)
    .digest("hex");
}
