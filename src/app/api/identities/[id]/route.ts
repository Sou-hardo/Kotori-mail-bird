import { NextResponse } from "next/server";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { identitySchema } from "../route";
export async function PATCH(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await requireCurrentTenant();
  const { id } = await params;
  const input = identitySchema.partial().parse(await r.json());
  const found = await db.identityProfile.findFirst({ where: { id, userId } });
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const item = await db.$transaction(async (tx) => {
    if (input.isDefault)
      await tx.identityProfile.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    return tx.identityProfile.update({ where: { id }, data: input });
  });
  return NextResponse.json(item);
}
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await requireCurrentTenant();
  const { id } = await params;
  await db.identityProfile.deleteMany({ where: { id, userId } });
  return new NextResponse(null, { status: 204 });
}
