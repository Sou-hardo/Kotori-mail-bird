import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = 1;

type CredentialEnvelope = {
  v: 1;
  iv: string;
  tag: string;
  data: string;
};

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "Credential encryption key must decode to exactly 32 bytes",
    );
  }
  return key;
}

export function encryptCredentials<T>(value: T, encodedKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, decodeKey(encodedKey), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const envelope: CredentialEnvelope = {
    v: VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function decryptCredentials<T>(payload: string, encodedKey: string): T {
  const envelope = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Partial<CredentialEnvelope>;
  if (
    envelope.v !== VERSION ||
    !envelope.iv ||
    !envelope.tag ||
    !envelope.data
  ) {
    throw new Error("Unsupported or malformed credential envelope");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    decodeKey(encodedKey),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}
