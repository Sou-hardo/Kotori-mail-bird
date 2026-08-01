import { describe, expect, it } from "vitest";
import {
  requireUserId,
  tenantWhere,
  UnauthorizedError,
} from "./tenant-primitives";

describe("tenant authorization primitives", () => {
  it("requires an authenticated user", () => {
    expect(() => requireUserId(null)).toThrow(UnauthorizedError);
    expect(requireUserId({ user: { id: "user-1" } })).toBe("user-1");
  });

  it("always applies the tenant boundary last", () => {
    expect(
      tenantWhere("tenant-safe", {
        tenantId: "tenant-hostile",
        status: "ACTIVE",
      }),
    ).toEqual({
      tenantId: "tenant-safe",
      status: "ACTIVE",
    });
  });
});
