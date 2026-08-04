import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchAuthMutation } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";
export async function PATCH(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = z
    .object({
      title: z.string().min(1).optional(),
      note: z.string().optional(),
      dueAt: z.coerce.date().optional(),
      status: z.enum(["OPEN", "SNOOZED", "DONE"]).optional(),
    })
    .parse(await r.json());
  const reminder = await fetchAuthMutation(api.jobs.saveReminder, {
    id,
    input: {
      ...input,
      ...(input.dueAt ? { dueAt: input.dueAt.getTime() } : {}),
    },
  });
  return NextResponse.json(reminder ? { count: 1 } : { count: 0 });
}
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await fetchAuthMutation(api.jobs.deleteReminder, { id });
  return new NextResponse(null, { status: 204 });
}
