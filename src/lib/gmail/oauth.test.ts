import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "@/lib/gmail/oauth";

describe("Gmail OAuth state", () => {
  const secret = "a secure test secret with more than 32 characters";
  it("round trips signed tenant/user state", () => {
    const token = createOAuthState("tenant-1", "user-1", secret, 1000);
    expect(verifyOAuthState(token, secret, 2000)).toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1",
    });
  });
  it("rejects tampering and expiry", () => {
    const token = createOAuthState("tenant-1", "user-1", secret, 1000);
    expect(() => verifyOAuthState(`${token}x`, secret, 2000)).toThrow(
      "Invalid OAuth state",
    );
    expect(() => verifyOAuthState(token, secret, 700_000)).toThrow(
      "Expired OAuth state",
    );
  });
});
