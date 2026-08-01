import type { Credentials } from "google-auth-library";
import { google } from "googleapis";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import {
  decryptCredentials,
  encryptCredentials,
} from "@/lib/security/credentials";
import { oauthClient } from "@/lib/gmail/oauth";
import { mergeRefreshedCredentials } from "@/lib/gmail/tokens";

export async function authorizedGmail(connectionId: string) {
  const connection = await db.gmailConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  const env = getServerEnv();
  const credentials = decryptCredentials<Credentials>(
    connection.encryptedCredentials,
    env.CREDENTIAL_ENCRYPTION_KEY,
  );
  const client = oauthClient();
  client.setCredentials(credentials);
  client.on("tokens", async (tokens) => {
    const merged = mergeRefreshedCredentials(credentials, tokens);
    await db.gmailConnection.update({
      where: { id: connection.id },
      data: {
        encryptedCredentials: encryptCredentials(
          merged,
          env.CREDENTIAL_ENCRYPTION_KEY,
        ),
        status: "ACTIVE",
        lastError: null,
      },
    });
  });
  return {
    gmail: google.gmail({ version: "v1", auth: client }),
    client,
    connection,
  };
}

export async function revokeConnection(connectionId: string) {
  const { client, connection } = await authorizedGmail(connectionId);
  try {
    await client.revokeCredentials();
  } finally {
    await db.gmailConnection.update({
      where: { id: connection.id },
      data: {
        status: "REVOKED",
        encryptedCredentials: "revoked",
        lastError: null,
      },
    });
  }
}
