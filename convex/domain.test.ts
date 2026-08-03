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
