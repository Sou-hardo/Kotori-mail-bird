import { beforeAll, describe, expect, it } from "vitest";
import { aad, decrypt, encrypt, mailboxScope, userScope } from "./crypto";

const KEY_A = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const KEY_B = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";

const MAILBOX = mailboxScope("conn_1");
const OTHER_MAILBOX = mailboxScope("conn_2");
const FIELD = aad("user_1", "conn_1", "emailMessages.bodyText");

beforeAll(() => {
  process.env.MAIL_ENCRYPTION_KEY = KEY_A;
});

describe("mail field encryption", () => {
  it("round-trips through the mailbox key", async () => {
    const payload = await encrypt("wire the money by friday", MAILBOX, FIELD);
    expect(payload.startsWith("v1:")).toBe(true);
    expect(payload).not.toContain("wire the money");
    expect(await decrypt(payload, MAILBOX, FIELD)).toBe(
      "wire the money by friday",
    );
  });

  it("uses a fresh IV per call", async () => {
    const a = await encrypt("same text", MAILBOX, FIELD);
    const b = await encrypt("same text", MAILBOX, FIELD);
    expect(a).not.toBe(b);
  });

  it("refuses another mailbox's key", async () => {
    const payload = await encrypt("secret", MAILBOX, FIELD);
    await expect(decrypt(payload, OTHER_MAILBOX, FIELD)).rejects.toThrow();
  });

  it("refuses a user-scoped key for mailbox content", async () => {
    const payload = await encrypt("secret", MAILBOX, FIELD);
    await expect(
      decrypt(payload, userScope("user_1"), FIELD),
    ).rejects.toThrow();
  });

  it("binds the owner, the mailbox and the field", async () => {
    const payload = await encrypt("secret", MAILBOX, FIELD);
    for (const wrong of [
      aad("user_2", "conn_1", "emailMessages.bodyText"),
      aad("user_1", "conn_2", "emailMessages.bodyText"),
      aad("user_1", "conn_1", "emailMessages.snippet"),
    ])
      await expect(decrypt(payload, MAILBOX, wrong)).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const payload = await encrypt("secret", MAILBOX, FIELD);
    const flipped =
      payload.slice(0, -2) + (payload.endsWith("AA") ? "BB" : "AA");
    await expect(decrypt(flipped, MAILBOX, FIELD)).rejects.toThrow();
  });

  it("rejects an unknown ciphertext version", async () => {
    const payload = await encrypt("secret", MAILBOX, FIELD);
    await expect(
      decrypt(payload.replace(/^v1:/, "v2:"), MAILBOX, FIELD),
    ).rejects.toThrow(/malformed|Unsupported/);
    await expect(decrypt("not-a-ciphertext", MAILBOX, FIELD)).rejects.toThrow();
  });

  it("cannot be read with a different master key", async () => {
    const payload = await encrypt("secret", MAILBOX, FIELD);
    process.env.MAIL_ENCRYPTION_KEY = KEY_B;
    try {
      await expect(decrypt(payload, MAILBOX, FIELD)).rejects.toThrow();
    } finally {
      process.env.MAIL_ENCRYPTION_KEY = KEY_A;
    }
  });

  it("rejects a master key that is not 32 bytes", async () => {
    process.env.MAIL_ENCRYPTION_KEY = "c2hvcnQ=";
    try {
      await expect(encrypt("secret", MAILBOX, FIELD)).rejects.toThrow(
        /32 bytes/,
      );
    } finally {
      process.env.MAIL_ENCRYPTION_KEY = KEY_A;
    }
  });
});
