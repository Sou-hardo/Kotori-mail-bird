// Field-level encryption for mailbox-derived content.
//
// Unlike `src/lib/security/credentials.ts` (node:crypto, Node actions only),
// this uses Web Crypto so the same code runs in the Convex V8 isolate where
// the mail mutations and queries live.
//
// Ciphertext format: `v1:<base64url iv>.<base64url ciphertext||tag>`.
// The version prefix is what makes rotation to a future scheme possible.

const VERSION = "v1";
const IV_BYTES = 12;

const MAILBOX_INFO = "kotori-mailbox-v1|";
const USER_INFO = "kotori-user-v1|";

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8");

const b64urlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const b64urlDecode = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const b64Decode = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// ponytail: derived keys are cached per isolate, keyed by master key as well
// as scope, so rotating MAIL_ENCRYPTION_KEY cannot be served a stale entry.
// The cache only ever saves the HMAC+import round trip.
const derivedKeys = new Map<string, Promise<CryptoKey>>();

function masterKey(): string {
  const encoded = process.env.MAIL_ENCRYPTION_KEY;
  if (!encoded) throw new Error("MAIL_ENCRYPTION_KEY is not set");
  if (b64Decode(encoded).length !== 32)
    throw new Error("MAIL_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return encoded;
}

// Key separation per mailbox (or per user, for rows that belong to a person
// rather than a connection). HMAC-SHA256 rather than HKDF because the Convex
// runtime's `subtle.deriveBits` coverage is incomplete, while `sign` is not.
async function keyFor(scope: string): Promise<CryptoKey> {
  const master = masterKey();
  const cacheKey = `${master}|${scope}`;
  const cached = derivedKeys.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      b64Decode(master) as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const derived = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      utf8.encode(scope) as BufferSource,
    );
    return crypto.subtle.importKey("raw", derived, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  })();
  derivedKeys.set(cacheKey, promise);
  return promise;
}

export const mailboxScope = (connectionId: string) =>
  MAILBOX_INFO + connectionId;
export const userScope = (userId: string) => USER_INFO + userId;

// Binds a ciphertext to the owner, the row's mailbox/user, and the exact
// field it was written to. Moving a value between rows, fields or users makes
// decryption fail rather than silently succeed.
export const aad = (ownerUserId: string, scopeId: string, field: string) =>
  `${ownerUserId}|${scopeId}|${field}`;

export async function encrypt(
  plaintext: string,
  scope: string,
  associatedData: string,
): Promise<string> {
  // ponytail: IVs come from crypto.getRandomValues. Convex replays a retried
  // mutation with the same seed, so a retry re-encrypts identical plaintext
  // under an identical IV -- same input, same output, no nonce reuse across
  // differing plaintexts. Revisit if encryption ever moves to a path where a
  // replay can see different data.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: utf8.encode(associatedData) as BufferSource,
    },
    await keyFor(scope),
    utf8.encode(plaintext) as BufferSource,
  );
  return `${VERSION}:${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ciphertext))}`;
}

export async function decrypt(
  payload: string,
  scope: string,
  associatedData: string,
): Promise<string> {
  const [version, rest] = payload.split(":", 2);
  if (version !== VERSION || !rest)
    throw new Error("Unsupported or malformed mail ciphertext");
  const [ivPart, dataPart] = rest.split(".", 2);
  if (!ivPart || !dataPart)
    throw new Error("Unsupported or malformed mail ciphertext");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64urlDecode(ivPart) as BufferSource,
      additionalData: utf8.encode(associatedData) as BufferSource,
    },
    await keyFor(scope),
    b64urlDecode(dataPart) as BufferSource,
  );
  return fromUtf8.decode(plaintext);
}

// Optional-field passthrough: `undefined` stays `undefined` so schema
// optionality survives a round trip.
export const encMaybe = (
  plaintext: string | undefined,
  scope: string,
  associatedData: string,
): Promise<string | undefined> =>
  plaintext === undefined
    ? Promise.resolve(undefined)
    : encrypt(plaintext, scope, associatedData);

export const decMaybe = (
  payload: string | undefined,
  scope: string,
  associatedData: string,
): Promise<string | undefined> =>
  payload === undefined
    ? Promise.resolve(undefined)
    : decrypt(payload, scope, associatedData);

// Arrays and structured values (headers, safetyFlags, requestedActions) go in
// as JSON so there is one ciphertext per field rather than per element.
export const encJson = (
  value: unknown,
  scope: string,
  associatedData: string,
): Promise<string | undefined> =>
  value === undefined
    ? Promise.resolve(undefined)
    : encrypt(JSON.stringify(value), scope, associatedData);

export async function decJson<T>(
  payload: string | undefined,
  scope: string,
  associatedData: string,
): Promise<T | undefined> {
  if (payload === undefined) return undefined;
  return JSON.parse(await decrypt(payload, scope, associatedData)) as T;
}
