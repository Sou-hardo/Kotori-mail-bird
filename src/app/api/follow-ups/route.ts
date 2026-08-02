import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
const schema = z.object({
  title: z.string().min(1),
  note: z.string().optional(),
  dueAt: z.coerce.date(),
  threadId: z.string().optional(),
});
export async function GET() {
  return NextResponse.json(
    await fetchAuthQuery(convexApi.domain.listReminders, {}),
  );
}
export async function POST(r: Request) {
  const input = schema.parse(await r.json());
  const reminder = await fetchAuthMutation(convexApi.jobs.saveReminder, {
    input: { ...input, dueAt: input.dueAt.getTime() },
  });
  return NextResponse.json(reminder, { status: 201 });
}
