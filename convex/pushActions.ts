"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async () => ({ configured: Boolean(process.env.VAPID_PRIVATE_KEY) }),
});
