import { NextResponse } from "next/server";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { identitySchema } from "@/lib/identity-schema";
export async function GET() {
  return NextResponse.json(
    await fetchAuthQuery(convexApi.domain.listIdentities, {}),
  );
}
export async function POST(r: Request) {
  const input = identitySchema.parse(await r.json());
  const item = await fetchAuthMutation(convexApi.domain.saveIdentity, {
    input,
  });
  return NextResponse.json(item, { status: 201 });
}
