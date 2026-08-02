import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { convexApi } from "@/lib/convex-api";

export const dynamic = "force-dynamic";

export async function readinessResponse(check: () => Promise<unknown>) {
  try {
    await check();
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

export function GET() {
  return readinessResponse(() =>
    new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(
      convexApi.health.ready,
      {},
    ),
  );
}
