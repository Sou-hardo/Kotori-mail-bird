import { describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = query;
  },
}));

describe("GET /api/health", () => {
  it("reports readiness without caching", async () => {
    query.mockResolvedValueOnce([]);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returns 503 while Convex is unavailable", async () => {
    query.mockRejectedValueOnce(new Error("offline"));
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
