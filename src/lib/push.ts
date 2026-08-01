import webpush from "web-push";
import { db } from "@/lib/db";

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string },
) {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return [];
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
  });
  return Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        return await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
        );
      } catch (error) {
        if (
          typeof error === "object" &&
          error &&
          "statusCode" in error &&
          (error.statusCode === 404 || error.statusCode === 410)
        )
          await db.pushSubscription.delete({ where: { id: subscription.id } });
        throw error;
      }
    }),
  );
}
