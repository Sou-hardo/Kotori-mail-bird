import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "../../../../convex/_generated/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(
      api.health.ready,
      {},
    );
    return NextResponse.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
