import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
export const identitySchema = z.object({
  label: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email(),
  role: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  pronouns: z.string().optional(),
  signature: z.string().min(1),
  closing: z.string().min(1),
  isDefault: z.boolean().default(false),
});
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
