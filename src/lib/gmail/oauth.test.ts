import { describe, expect, it, vi } from "vitest";
import {
  GMAIL_SCOPES,
  allowedGmailScopes,
  createOAuthState,
  gmailAuthorizationUrl,
  verifyOAuthState,
} from "@/lib/gmail/oauth";

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    GMAIL_OAUTH_CLIENT_ID: "client-id",
    GMAIL_OAUTH_CLIENT_SECRET: "client-secret",
    GMAIL_OAUTH_REDIRECT_URI: "https://example.com/api/gmail/callback",
  }),
}));

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

describe("gmailAuthorizationUrl", () => {
  it("requests Gmail and identity scopes but nothing broader", () => {
    const url = new URL(gmailAuthorizationUrl("state-token", "challenge"));
    const scope = url.searchParams.get("scope") ?? "";
    const requested = scope.split(" ");
    expect(requested).toEqual(expect.arrayContaining([...GMAIL_SCOPES]));
    expect(requested).toEqual(expect.arrayContaining(["openid", "email"]));
    // Substring checks rather than regexes: CodeQL flags unanchored URL
    // patterns (js/regex/missing-regexp-anchor), and containment is exactly
    // what this assertion means.
    expect(scope).not.toContain("gmail.modify");
    expect(scope).not.toContain("gmail.send");
    expect(scope).not.toContain("mail.google.com");
  });
});

describe("allowedGmailScopes", () => {
  it("drops openid/email and keeps exactly the Gmail scopes", () => {
    const granted = [...GMAIL_SCOPES, "openid", "email"].join(" ");
    expect(allowedGmailScopes(granted)).toEqual([...GMAIL_SCOPES]);
  });
  it("returns a short array for a partial grant", () => {
    expect(allowedGmailScopes(GMAIL_SCOPES[0])).toEqual([GMAIL_SCOPES[0]]);
    expect(allowedGmailScopes(undefined)).toEqual([]);
  });
});
