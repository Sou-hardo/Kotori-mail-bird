import type { Credentials } from "google-auth-library";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { fetchAuthMutation } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { getServerEnv } from "@/lib/env";
import {
  GMAIL_SCOPES,
  allowedGmailScopes,
  oauthClient,
  verifyOAuthState,
} from "@/lib/gmail/oauth";
import {
  encryptCredentials,
  decryptCredentials,
} from "@/lib/security/credentials";

type CallbackErrorCode = "state" | "consent" | "identity" | "unknown";

export async function GET(request: Request) {
  const env = getServerEnv();
  const jar = await cookies();
  const cookie = jar.get("gmail_oauth")?.value;
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateToken = url.searchParams.get("state");
    if (!code || !stateToken || !cookie)
      return NextResponse.json(
        { error: "Invalid OAuth callback" },
        { status: 400 },
      );
    const state = verifyOAuthState(stateToken, env.BETTER_AUTH_SECRET);
    const pending = decryptCredentials<{ state: string; verifier: string }>(
      cookie,
      env.CREDENTIAL_ENCRYPTION_KEY,
    );
    if (pending.state !== stateToken)
      return NextResponse.json(
        { error: "OAuth state mismatch" },
        { status: 400 },
      );
    const principal = await requireCurrentTenant(state.tenantId);
    if (principal.userId !== state.userId)
      return NextResponse.json(
        { error: "OAuth principal mismatch" },
        { status: 403 },
      );
    const client = oauthClient();
    const { tokens } = await client.getToken({
      code,
      codeVerifier: pending.verifier,
    });
    client.setCredentials(tokens);
    const scopes = allowedGmailScopes(tokens.scope);
    if (scopes.length !== GMAIL_SCOPES.length || !tokens.refresh_token)
      return NextResponse.redirect(
        new URL("/connect?error=consent", env.APP_URL),
      );
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: env.GMAIL_OAUTH_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error("identity");
    const encryptedCredentials = encryptCredentials(
      tokens as Credentials,
      env.CREDENTIAL_ENCRYPTION_KEY,
    );
    const connection = await fetchAuthMutation(
      convexApi.domain.upsertConnection,
      {
        tenantId: state.tenantId,
        actorId: state.userId,
        googleAccountId: payload.sub,
        emailAddress: payload.email,
        encryptedCredentials,
        scopes,
      },
    );
    await fetchAuthMutation(convexApi.jobs.enqueue, {
      kind: "gmail.sync",
      input: { connectionId: connection.id, forceFull: true },
      dedupeKey: `${connection.id}:initial`,
    });
    return NextResponse.redirect(
      new URL("/inbox?gmail=connected", env.APP_URL),
    );
  } catch (error) {
    console.error("Gmail OAuth callback failed", error);
    return NextResponse.redirect(
      new URL(`/connect?error=${errorCode(error)}`, env.APP_URL),
    );
  } finally {
    jar.set("gmail_oauth", "", { path: "/api/gmail/callback", maxAge: 0 });
  }
}

function errorCode(error: unknown): CallbackErrorCode {
  if (error instanceof Error) {
    if (
      error.message === "Invalid OAuth state" ||
      error.message === "Expired OAuth state"
    )
      return "state";
    if (error.message === "identity") return "identity";
  }
  return "unknown";
}
