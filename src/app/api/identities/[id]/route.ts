import { NextResponse } from "next/server";
import { fetchAuthMutation } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { identitySchema } from "@/lib/identity-schema";
export async function PATCH(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = identitySchema.partial().parse(await r.json());
  const item = await fetchAuthMutation(convexApi.domain.saveIdentity, {
    id,
    input,
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(item);
}
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await fetchAuthMutation(convexApi.domain.deleteIdentity, { id });
  return new NextResponse(null, { status: 204 });
}
