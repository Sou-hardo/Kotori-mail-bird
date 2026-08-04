import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

beforeEach(() => {
  vi.resetModules();
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
