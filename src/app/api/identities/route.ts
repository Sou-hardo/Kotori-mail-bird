import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
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
  const { userId } = await requireCurrentTenant();
  return NextResponse.json(
    await db.identityProfile.findMany({
      where: { userId },
      orderBy: { label: "asc" },
    }),
  );
}
export async function POST(r: Request) {
  const { userId } = await requireCurrentTenant();
  const input = identitySchema.parse(await r.json());
  const item = await db.$transaction(async (tx) => {
    if (input.isDefault)
      await tx.identityProfile.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    return tx.identityProfile.create({ data: { ...input, userId } });
  });
  return NextResponse.json(item, { status: 201 });
}
