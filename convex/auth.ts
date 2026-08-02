import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const authFunctions: AuthFunctions = internal.auth;

const tenantSlug = (authUserId: string, label: string) => {
  let hash = 0xcbf29ce484222325n;
  for (const character of authUserId) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  const prefix =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "workspace";
  return `${prefix}-${hash.toString(16).padStart(16, "0")}`;
};

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        const now = Date.now();
        const existingUser = await ctx.db
          .query("users")
          .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
          .unique();
        const userId = existingUser
          ? existingUser._id
          : await ctx.db.insert("users", {
              authUserId: authUser._id,
              name: authUser.name,
              email: authUser.email,
              image: authUser.image ?? undefined,
              generateThreeSuggestions: false,
              createdAt: now,
              updatedAt: now,
            });
        if (existingUser)
          await ctx.db.patch(existingUser._id, {
            name: authUser.name,
            email: authUser.email,
            image: authUser.image ?? undefined,
            updatedAt: now,
          });

        const existingMembership = await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .order("asc")
          .first();
        if (existingMembership) return;

        const label =
          authUser.name?.trim() || authUser.email?.split("@")[0] || "My";
        const existingTenant = await ctx.db
          .query("tenants")
          .withIndex("by_owner_auth_user", (q) =>
            q.eq("ownerAuthUserId", authUser._id),
          )
          .unique();
        const tenantId = existingTenant
          ? existingTenant._id
          : await ctx.db.insert("tenants", {
              name: `${label}'s workspace`,
              slug: tenantSlug(authUser._id, label),
              ownerAuthUserId: authUser._id,
              createdAt: now,
              updatedAt: now,
            });
        await ctx.db.insert("memberships", {
          tenantId,
          userId,
          role: "OWNER",
          createdAt: now,
        });
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,
    database: authComponent.adapter(ctx),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        scope: ["openid", "email", "profile"],
      },
    },
    plugins: [convex({ authConfig })],
  });

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.getAuthUser(ctx),
});
