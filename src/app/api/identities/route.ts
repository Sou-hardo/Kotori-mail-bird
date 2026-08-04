import { NextResponse } from "next/server";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { api } from "../../../../convex/_generated/api";
import { identitySchema } from "@/lib/identity-schema";
export async function GET() {
  return NextResponse.json(await fetchAuthQuery(api.domain.listIdentities, {}));
}
export async function POST(r: Request) {
  const input = identitySchema.parse(await r.json());
  const item = await fetchAuthMutation(api.domain.saveIdentity, {
    input,
  });
  return NextResponse.json(item, { status: 201 });
}
