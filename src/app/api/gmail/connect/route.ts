import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { getServerEnv } from "@/lib/env";
import {
  createOAuthState,
  createPkce,
  gmailAuthorizationUrl,
} from "@/lib/gmail/oauth";
import { encryptCredentials } from "@/lib/security/credentials";

export async function GET(request: Request) {
  const tenantId =
    new URL(request.url).searchParams.get("tenantId") ?? undefined;
  const principal = await requireCurrentTenant(tenantId);
  const env = getServerEnv();
  const state = createOAuthState(
    principal.tenantId,
    principal.userId,
    env.BETTER_AUTH_SECRET,
  );
  const pkce = createPkce();
  const jar = await cookies();
  jar.set(
    "gmail_oauth",
    encryptCredentials(
      { state, verifier: pkce.verifier },
      env.CREDENTIAL_ENCRYPTION_KEY,
    ),
    {
      httpOnly: true,
      secure: env.APP_URL.startsWith("https:"),
      sameSite: "lax",
      path: "/api/gmail/callback",
      maxAge: 600,
    },
  );
  return NextResponse.redirect(gmailAuthorizationUrl(state, pkce.challenge));
}
