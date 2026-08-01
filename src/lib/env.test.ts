import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateServerEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/kotori",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "a-secret-that-is-at-least-32-characters",
  AUTH_GOOGLE_ID: "client-id",
  AUTH_GOOGLE_SECRET: "client-secret",
  APP_URL: "http://localhost:3000",
  GMAIL_OAUTH_CLIENT_ID: "gmail-client-id",
  GMAIL_OAUTH_CLIENT_SECRET: "gmail-client-secret",
  GMAIL_OAUTH_REDIRECT_URI: "http://localhost:3000/api/gmail/callback",
  CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

describe("server environment", () => {
  it("accepts a complete environment", () => {
    expect(validateServerEnv(valid).DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it("rejects a malformed encryption key", () => {
    expect(() =>
      validateServerEnv({ ...valid, CREDENTIAL_ENCRYPTION_KEY: "short" }),
    ).toThrow();
  });
});
