import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { userBox } from "./mailCrypto";

export const forNotification = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const row = await ctx.db.get(notificationId);
    if (!row) return null;
    const box = userBox(String(row.userId));
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .collect();
    return {
      notification: {
        ...row,
        title: (await box.dec("notifications.title", row.title)) ?? "",
        body: (await box.dec("notifications.body", row.body)) ?? "",
      },
      subscriptions,
    };
  },
});
export const remove = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: (ctx, { id }) => ctx.db.delete(id),
});
