import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
const schema = z.object({
  title: z.string().min(1),
  note: z.string().optional(),
  dueAt: z.coerce.date(),
  threadId: z.string().optional(),
});
export async function GET() {
  const { userId } = await requireCurrentTenant();
  return NextResponse.json(
    await db.followUpReminder.findMany({
      where: { userId },
      orderBy: { dueAt: "asc" },
    }),
  );
}
export async function POST(r: Request) {
  const { userId } = await requireCurrentTenant();
  return NextResponse.json(
    await db.followUpReminder.create({
      data: { ...schema.parse(await r.json()), userId },
    }),
    { status: 201 },
  );
}
