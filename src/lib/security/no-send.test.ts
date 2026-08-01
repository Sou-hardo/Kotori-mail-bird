import { readFile, readdir } from "node:fs/promises";
import { extname, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GMAIL_SCOPES } from "@/lib/gmail/oauth";

const sourceRoot = new URL("../../../", import.meta.url);
const forbidden = [
  /users\s*\.\s*messages\s*\.\s*send\s*\(/i,
  /messages\s*\.\s*send\s*\(/i,
  /gmail[-_. ]?send/i,
  /send[-_. ]?(?:email|message)/i,
  /\/api\/gmail\/send/i,
  /queue\([^)]*send/i,
];

async function sources(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory())
        return ["node_modules", ".git", ".next", "src/generated"].some(
          (ignored) => path.pathname.includes(`/${ignored}/`),
        )
          ? []
          : sources(path);
      return [
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".json",
        ".yml",
        ".yaml",
        ".prisma",
      ].includes(extname(entry.name)) &&
        !entry.name.includes(".test.") &&
        !path.pathname.endsWith("src/lib/security/no-send.test.ts")
        ? [path.pathname]
        : [];
    }),
  );
  return nested.flat();
}

describe("never-send architecture", () => {
  it("does not request Gmail send or broad mail scopes", () => {
    expect(GMAIL_SCOPES).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
    expect(GMAIL_SCOPES.join(" ")).not.toMatch(
      /gmail\.modify|mail\.google\.com/,
    );
  });

  it("contains no Gmail send endpoint, method, or queue", async () => {
    const violations: string[] = [];
    for (const file of await sources(sourceRoot)) {
      const body = await readFile(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(body))
          violations.push(
            `${relative(process.cwd(), file)} matches ${pattern}`,
          );
      }
    }
    expect(violations).toEqual([]);
  });
});
