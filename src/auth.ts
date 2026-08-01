import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

const env = getServerEnv();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  secret: env.AUTH_SECRET,
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope: "openid email profile",
        },
      },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id)
        throw new Error("Auth adapter created a user without an id");
      const label = user.name?.trim() || user.email?.split("@")[0] || "My";
      await db.tenant.create({
        data: {
          name: `${label}'s workspace`,
          slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${user.id.slice(-6)}`,
          memberships: { create: { userId: user.id, role: "OWNER" } },
        },
      });
    },
  },
});
