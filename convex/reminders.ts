import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
export const fire = internalMutation({
  args: { reminderId: v.id("followUpReminders") },
  handler: async (ctx, { reminderId }) => {
    const r = await ctx.db.get(reminderId);
    if (!r || r.status === "DONE" || r.dueAt > Date.now())
      return { skipped: true };
    const id = await ctx.db.insert("notifications", {
      userId: r.userId,
      threadId: r.threadId,
      kind: "FOLLOW_UP",
      title: r.title,
      body: r.note ?? "Follow-up reminder is due.",
      createdAt: Date.now(),
    });
    return { notificationId: id };
  },
});
