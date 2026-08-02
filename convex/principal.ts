/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { authComponent } from "./auth";
import type { Id } from "./_generated/dataModel";

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
  const membership = requestedTenantId
    ? await ctx.db
        .query("memberships")
        .withIndex("by_tenant_user", (q) =>
          q
            .eq("tenantId", requestedTenantId as Id<"tenants">)
            .eq("userId", user._id),
        )
        .unique()
    : await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
  if (!membership) throw new ConvexError("Forbidden");
  return {
    user,
    userId: user._id,
    tenantId: membership.tenantId,
    role: membership.role,
  };
}

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
  const { _id, _creationTime: _, ...rest } = doc;
  const out: Record<string, unknown> = { id: _id, ...rest };
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
  return out;
};
