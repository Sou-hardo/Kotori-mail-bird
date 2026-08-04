import { NextResponse } from "next/server";
import { fetchAuthMutation } from "@/lib/auth-server";
import { api } from "../../../../../convex/_generated/api";

export async function POST(request: Request) {
  const { connectionId } = (await request.json()) as { connectionId?: string };
  if (!connectionId)
    return NextResponse.json(
      { error: "connectionId required" },
      { status: 400 },
    );
  return NextResponse.json(
    await fetchAuthMutation(api.domain.revokeConnection, {
      id: connectionId,
    }),
  );
}
