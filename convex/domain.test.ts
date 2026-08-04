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

// Mail access is mailbox-owner-scoped (issue #61). The owner checks live in
// principal.ts and are exercised in access.test.ts; what can't be reached
// through those helpers is a *new* handler that gates on tenant membership
// instead. Pin the sources so that regression shows up as a failing test.
describe("mail authorization sources", () => {
  const read = (file: string) =>
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

  it.each(["./domain.ts", "./jobs.ts", "./aiData.ts"])(
    "%s never authorizes mail by comparing tenantIds",
    (file) => {
      expect(read(file)).not.toMatch(/tenantId\s*!==\s*\w+\.tenantId/);
    },
  );

  it("routes every mail lookup in domain.ts through an owner helper", () => {
    const source = read("./domain.ts");
    // A raw ctx.db.get() cast to a mail id would sidestep the helpers.
    expect(source).not.toMatch(
      /ctx\.db\.get\([^)]*as Id<"(emailThreads|gmailConnections)">/,
    );
    for (const helper of ["ownedThread", "ownedConnection", "ownedConnections"])
      expect(source).toContain(helper);
  });
});
