"use node";
import { v } from "convex/values";
import webPush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const send = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const data = await ctx.runQuery(internal.pushData.forNotification, {
      notificationId,
    });
    if (
      !data ||
      !process.env.VAPID_PRIVATE_KEY ||
      !process.env.VAPID_PUBLIC_KEY
    )
      return { configured: false };
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    let delivered = 0;
    for (const subscription of data.subscriptions) {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: data.notification.title,
            body: data.notification.body,
            url: data.notification.threadId
              ? `/inbox/${data.notification.threadId}`
              : "/notifications",
          }),
        );
        delivered++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410)
          await ctx.runMutation(internal.pushData.remove, {
            id: subscription._id,
          });
        else throw error;
      }
    }
    return { delivered };
  },
});
