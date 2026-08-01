import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/x");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.stubEnv("AUTH_SECRET", "a-secret-that-is-at-least-32-characters");
  vi.stubEnv("AUTH_GOOGLE_ID", "x");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "x");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("GMAIL_OAUTH_CLIENT_ID", "x");
  vi.stubEnv("GMAIL_OAUTH_CLIENT_SECRET", "x");
  vi.stubEnv("GMAIL_OAUTH_REDIRECT_URI", "http://localhost/callback");
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("DEEPSEEK_API_KEY", "x");
  vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
  vi.stubEnv("DEEPSEEK_MODEL", "deepseek-chat");
});

describe("DeepSeek JSON boundary", () => {
  it.each([
    [
      "empty",
      { choices: [{ finish_reason: "stop", message: { content: "" } }] },
    ],
    [
      "malformed",
      { choices: [{ finish_reason: "stop", message: { content: "{" } }] },
    ],
    [
      "truncated",
      {
        choices: [
          { finish_reason: "length", message: { content: '{"ok":true}' } },
        ],
      },
    ],
  ])("rejects %s output", async (_, envelope) => {
    const { deepSeekJson } = await import("./deepseek");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      deepSeekJson("system", "user", z.object({ ok: z.boolean() }), fetcher),
    ).rejects.toThrow();
  });
});
