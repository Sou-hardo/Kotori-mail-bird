import type { Credentials } from "google-auth-library";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { GMAIL_SCOPES, oauthClient, verifyOAuthState } from "@/lib/gmail/oauth";
import {
  encryptCredentials,
  decryptCredentials,
} from "@/lib/security/credentials";
import { enqueueSync } from "@/lib/jobs/queues";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const jar = await cookies();
  const cookie = jar.get("gmail_oauth")?.value;
  jar.delete("gmail_oauth");
  if (!code || !stateToken || !cookie)
    return NextResponse.json(
      { error: "Invalid OAuth callback" },
      { status: 400 },
    );
  const env = getServerEnv();
  const state = verifyOAuthState(stateToken, env.AUTH_SECRET);
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
  const oauth = await client.request<{ id: string; email: string }>({
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
  });
  const scopes = (tokens.scope?.split(" ") ?? [...GMAIL_SCOPES]).filter(
    (scope) => GMAIL_SCOPES.includes(scope as (typeof GMAIL_SCOPES)[number]),
  );
  if (scopes.length !== GMAIL_SCOPES.length || !tokens.refresh_token)
    return NextResponse.json(
      {
        error:
          "Gmail consent must include readonly, compose, and offline access",
      },
      { status: 400 },
    );
  const encryptedCredentials = encryptCredentials(
    tokens as Credentials,
    env.CREDENTIAL_ENCRYPTION_KEY,
  );
  const connection = await db.$transaction(async (tx) => {
    const saved = await tx.gmailConnection.upsert({
      where: {
        tenantId_googleAccountId: {
          tenantId: state.tenantId,
          googleAccountId: oauth.data.id,
        },
      },
      create: {
        tenantId: state.tenantId,
        googleAccountId: oauth.data.id,
        emailAddress: oauth.data.email,
        encryptedCredentials,
        scopes,
        syncState: { create: {} },
      },
      update: {
        emailAddress: oauth.data.email,
        encryptedCredentials,
        scopes,
        status: "ACTIVE",
        lastError: null,
      },
    });
    await tx.syncState.upsert({
      where: { gmailConnectionId: saved.id },
      create: { gmailConnectionId: saved.id },
      update: {},
    });
    await tx.auditEvent.create({
      data: {
        tenantId: state.tenantId,
        actorId: state.userId,
        action: "CONNECTION_CREATED",
        targetType: "GmailConnection",
        targetId: saved.id,
      },
    });
    return saved;
  });
  await enqueueSync(connection, true);
  return NextResponse.redirect(new URL("/?gmail=connected", env.APP_URL));
}
