import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { google } from "googleapis";
import { CodeChallengeMethod } from "google-auth-library";
import { getServerEnv } from "@/lib/env";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
] as const;

type OAuthState = {
  nonce: string;
  tenantId: string;
  userId: string;
  exp: number;
};

function sign(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

export function createOAuthState(
  tenantId: string,
  userId: string,
  secret: string,
  now = Date.now(),
) {
  const value: OAuthState = {
    nonce: randomBytes(18).toString("base64url"),
    tenantId,
    userId,
    exp: now + 10 * 60_000,
  };
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyOAuthState(
  token: string,
  secret: string,
  now = Date.now(),
) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) throw new Error("Invalid OAuth state");
  const expected = sign(encoded, secret);
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  )
    throw new Error("Invalid OAuth state");
  const value = JSON.parse(
    Buffer.from(encoded, "base64url").toString(),
  ) as OAuthState;
  if (!value.nonce || !value.tenantId || !value.userId || value.exp < now)
    throw new Error("Expired OAuth state");
  return value;
}

export function createPkce() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function oauthClient() {
  const env = getServerEnv();
  return new google.auth.OAuth2(
    env.GMAIL_OAUTH_CLIENT_ID,
    env.GMAIL_OAUTH_CLIENT_SECRET,
    env.GMAIL_OAUTH_REDIRECT_URI,
  );
}

export function gmailAuthorizationUrl(state: string, challenge: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: [...GMAIL_SCOPES],
    state,
    code_challenge: challenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
}
