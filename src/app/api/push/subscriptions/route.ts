import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export async function GET() {
  await requireCurrentTenant();
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey)
    return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  return NextResponse.json({ publicKey });
}
export async function POST(r: Request) {
  const { userId } = await requireCurrentTenant();
  const input = schema.parse(await r.json());
  await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: { p256dh: input.keys.p256dh, auth: input.keys.auth, userId },
    create: {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userId,
      userAgent: r.headers.get("user-agent"),
    },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
export async function DELETE(r: Request) {
  const { userId } = await requireCurrentTenant();
  const { endpoint } = z
    .object({ endpoint: z.string().url() })
    .parse(await r.json());
  await db.pushSubscription.deleteMany({ where: { endpoint, userId } });
  return new NextResponse(null, { status: 204 });
}
