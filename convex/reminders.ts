import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { userBox } from "./mailCrypto";
export const fire = internalMutation({
  args: { reminderId: v.id("followUpReminders") },
  handler: async (ctx, { reminderId }) => {
    const r = await ctx.db.get(reminderId);
    if (!r || r.status === "DONE" || r.dueAt > Date.now())
      return { skipped: true };
    // Re-encrypted under the notification field labels rather than copied:
    // the associated data names the field a ciphertext belongs to, so a
    // reminder ciphertext would not decrypt from a notification row.
    const box = userBox(String(r.userId));
    const title = (await box.dec("followUpReminders.title", r.title)) ?? "";
    const note = await box.dec("followUpReminders.note", r.note);
    const id = await ctx.db.insert("notifications", {
      userId: r.userId,
      threadId: r.threadId,
      kind: "FOLLOW_UP",
      title: (await box.enc("notifications.title", title))!,
      body: (await box.enc(
        "notifications.body",
        note ?? "Follow-up reminder is due.",
      ))!,
      createdAt: Date.now(),
    });
    const thread = r.threadId ? await ctx.db.get(r.threadId) : null;
    const membership = thread
      ? null
      : await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", r.userId))
          .first();
    const tenantId = thread?.tenantId ?? membership?.tenantId;
    if (tenantId)
      await ctx.scheduler.runAfter(0, internal.jobs.enqueueInternal, {
        tenantId,
        kind: "notification.push",
        input: { notificationId: id },
        dedupeKey: String(id),
      });
    return { notificationId: id };
  },
});
