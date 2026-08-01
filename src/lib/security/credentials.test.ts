import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials } from "./credentials";

describe("credential encryption", () => {
  const key = randomBytes(32).toString("base64");

  it("round trips structured credentials without exposing plaintext", () => {
    const credentials = {
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
    };
    const encrypted = encryptCredentials(credentials, key);
    expect(encrypted).not.toContain(credentials.accessToken);
    expect(decryptCredentials<typeof credentials>(encrypted, key)).toEqual(
      credentials,
    );
  });

  it("uses a fresh nonce for every envelope", () => {
    expect(encryptCredentials({ token: "same" }, key)).not.toBe(
      encryptCredentials({ token: "same" }, key),
    );
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptCredentials({ token: "secret" }, key);
    const envelope = JSON.parse(
      Buffer.from(encrypted, "base64url").toString("utf8"),
    );
    envelope.data = Buffer.from("tampered").toString("base64");
    const tampered = Buffer.from(JSON.stringify(envelope)).toString(
      "base64url",
    );
    expect(() => decryptCredentials(tampered, key)).toThrow();
  });
});
