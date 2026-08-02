import { NextResponse } from "next/server";
import { replyPreferenceSchema } from "@/lib/ai/schemas";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";

export async function GET() {
  const preference = await fetchAuthQuery(
    convexApi.domain.getReplyPreference,
    {},
  );
  return NextResponse.json(preference, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: Request) {
  const parsed = replyPreferenceSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_preference" }, { status: 400 });
  const preference = await fetchAuthMutation(
    convexApi.domain.setReplyPreference,
    parsed.data,
  );
  return NextResponse.json(preference);
}
