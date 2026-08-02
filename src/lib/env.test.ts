import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateServerEnv } from "./env";

const valid = {
  NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
  NEXT_PUBLIC_CONVEX_SITE_URL: "https://example.convex.site",
  BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-characters",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  APP_URL: "http://localhost:3000",
  GMAIL_OAUTH_CLIENT_ID: "gmail-client-id",
  GMAIL_OAUTH_CLIENT_SECRET: "gmail-client-secret",
  GMAIL_OAUTH_REDIRECT_URI: "http://localhost:3000/api/gmail/callback",
  CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  DEEPSEEK_API_KEY: "deepseek-test-key",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_MODEL: "deepseek-chat",
};

describe("server environment", () => {
  it("accepts a complete environment", () => {
    expect(validateServerEnv(valid).NEXT_PUBLIC_CONVEX_URL).toBe(
      valid.NEXT_PUBLIC_CONVEX_URL,
    );
  });

  it("rejects a malformed encryption key", () => {
    expect(() =>
      validateServerEnv({ ...valid, CREDENTIAL_ENCRYPTION_KEY: "short" }),
    ).toThrow();
  });

  it("treats empty optional VAPID values as unset", () => {
    const result = validateServerEnv({
      ...valid,
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
      VAPID_SUBJECT: "",
    });
    expect(result.VAPID_PUBLIC_KEY).toBeUndefined();
    expect(result.VAPID_PRIVATE_KEY).toBeUndefined();
    expect(result.VAPID_SUBJECT).toBeUndefined();
  });
});
