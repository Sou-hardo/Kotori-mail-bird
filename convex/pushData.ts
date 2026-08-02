import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const forNotification = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const notification = await ctx.db.get(notificationId);
    if (!notification) return null;
    const subscriptions = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", notification.userId))
      .collect();
    return { notification, subscriptions };
  },
});
export const remove = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: (ctx, { id }) => ctx.db.delete(id),
});
