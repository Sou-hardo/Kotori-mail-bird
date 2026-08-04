import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchAuthMutation } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";
const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey)
    return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  return NextResponse.json({ publicKey });
}
export async function POST(r: Request) {
  const input = schema.parse(await r.json());
  await fetchAuthMutation(api.domain.savePush, {
    endpoint: input.endpoint,
    ...input.keys,
    userAgent: r.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
export async function DELETE(r: Request) {
  const { endpoint } = z
    .object({ endpoint: z.string().url() })
    .parse(await r.json());
  await fetchAuthMutation(api.domain.deletePush, { endpoint });
  return new NextResponse(null, { status: 204 });
}
