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
export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        const now = Date.now();
        const userId = await ctx.db.insert("users", {
          authUserId: authUser._id,
          name: authUser.name,
          email: authUser.email,
          image: authUser.image,
          createdAt: now,
          updatedAt: now,
        });
        const label =
          authUser.name?.trim() || authUser.email?.split("@")[0] || "My";
        const slugBase =
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "") || "workspace";
        const tenantId = await ctx.db.insert("tenants", {
          name: `${label}'s workspace`,
          slug: `${slugBase}-${String(userId).slice(-6)}`,
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
