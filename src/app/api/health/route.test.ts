import { describe, expect, it, vi } from "vitest";
import { readinessResponse } from "./route";

describe("GET /api/health", () => {
  it("reports readiness without caching", async () => {
    const response = await readinessResponse(vi.fn().mockResolvedValue([]));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returns 503 while Convex is unavailable", async () => {
    const response = await readinessResponse(() =>
      Promise.reject(new Error("offline")),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
