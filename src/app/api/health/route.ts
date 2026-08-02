import { ConvexHttpClient } from "convex/browser";
import { convexApi } from "@/lib/convex-api";
import { readinessResponse } from "@/lib/health-readiness";

export const dynamic = "force-dynamic";

export function GET() {
  return readinessResponse(() =>
    new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(
      convexApi.health.ready,
      {},
    ),
  );
}
