import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectionDto } from "./domain";
import type { Doc } from "./_generated/dataModel";

const row = {
  _id: "connection_1",
  _creationTime: 1000,
  tenantId: "tenant_1",
  googleAccountId: "google_1",
  emailAddress: "user@example.com",
  encryptedCredentials: "super-secret-refresh-token",
  scopes: ["gmail.readonly"],
  status: "ACTIVE",
  createdAt: 1000,
  updatedAt: 2000,
} as unknown as Doc<"gmailConnections">;

describe("connectionDto", () => {
  it("omits encryptedCredentials", () => {
    const result = connectionDto(row);
    expect(result).not.toHaveProperty("encryptedCredentials");
    expect(JSON.stringify(result)).not.toContain("super-secret-refresh-token");
  });

  it("keeps every other field, projected like dto()", () => {
    const result = connectionDto(row);
    expect(result).toMatchObject({
      id: "connection_1",
      tenantId: "tenant_1",
      googleAccountId: "google_1",
      emailAddress: "user@example.com",
      scopes: ["gmail.readonly"],
      status: "ACTIVE",
    });
    expect(result).not.toHaveProperty("_id");
    expect(result).not.toHaveProperty("_creationTime");
  });
});

// getThread is wrapped by Convex's query() builder, which has no way to be
// invoked as a plain handler outside a Convex deployment, so it can't be
// unit-tested directly here. Pin the source so a future edit can't silently
// swap the redacted projection back for a raw dto(connection) leak.
describe("getThread source", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./domain.ts", import.meta.url)),
    "utf8",
  );

  it("projects the joined gmailConnection through connectionDto, not dto", () => {
    expect(source).toMatch(/gmailConnection:\s*connectionDto\(connection\)/);
    expect(source).not.toMatch(/gmailConnection:\s*dto\(connection\)/);
  });
});
