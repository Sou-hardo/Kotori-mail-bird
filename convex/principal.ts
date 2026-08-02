import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";

export async function requirePrincipal(
  ctx: QueryCtx | MutationCtx,
  requestedTenantId?: string,
) {
  const authUser = await authComponent.getAuthUser(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
    .unique();
  if (!user) throw new ConvexError("Unauthenticated");
  const requestedTenant = requestedTenantId
    ? ctx.db.normalizeId("tenants", requestedTenantId)
    : null;
  if (requestedTenantId && !requestedTenant) throw new ConvexError("Forbidden");
  const membership = requestedTenantId
    ? await ctx.db
        .query("memberships")
        .withIndex("by_tenant_user", (q) =>
          q.eq("tenantId", requestedTenant!).eq("userId", user._id),
        )
        .unique()
    : await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .order("asc")
        .first();
  if (!membership) throw new ConvexError("Forbidden");
  return {
    user,
    userId: user._id,
    tenantId: membership.tenantId,
    role: membership.role,
  };
}

type SerializedTimestamp =
  | "createdAt"
  | "updatedAt"
  | "dueAt"
  | "latestMessageAt"
  | "sentAt"
  | "readAt"
  | "lastStartedAt"
  | "lastCompletedAt"
  | "scheduledAt"
  | "startedAt"
  | "completedAt";

type Dto<T extends { _id: unknown; _creationTime: number }> = {
  [K in keyof Omit<T, "_id" | "_creationTime">]: K extends SerializedTimestamp
    ? T[K] extends number
      ? string
      : T[K] extends number | undefined
        ? string | undefined
        : T[K]
    : T[K];
} & { id: T["_id"] };

export const dto = <
  T extends {
    _id: unknown;
    _creationTime: number;
    createdAt?: number;
    updatedAt?: number;
    dueAt?: number;
    latestMessageAt?: number;
    sentAt?: number;
    readAt?: number;
  },
>(
  doc: T,
) => {
  const out: Record<string, unknown> = { ...doc, id: doc._id };
  delete out._id;
  delete out._creationTime;
  for (const key of [
    "createdAt",
    "updatedAt",
    "dueAt",
    "latestMessageAt",
    "sentAt",
    "readAt",
    "lastStartedAt",
    "lastCompletedAt",
    "scheduledAt",
    "startedAt",
    "completedAt",
  ]) {
    if (typeof out[key] === "number")
      out[key] = new Date(out[key] as number).toISOString();
  }
  return out as Dto<T>;
};
