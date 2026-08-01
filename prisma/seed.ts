import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { encryptCredentials } from "../src/lib/security/credentials";

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

if (process.env.NODE_ENV !== "development") {
  throw new Error("Seed is intentionally restricted to NODE_ENV=development");
}
if (!databaseUrl || !encryptionKey)
  throw new Error("DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY are required");
const seedEncryptionKey = encryptionKey;

const host = new URL(databaseUrl).hostname;
if (!["localhost", "127.0.0.1", "postgres"].includes(host)) {
  throw new Error(`Refusing to seed a non-local database host: ${host}`);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main() {
  await prisma.user.upsert({
    where: { email: "demo@kotori.local" },
    update: {},
    create: {
      id: "seed-user-demo",
      name: "Kotori Demo",
      email: "demo@kotori.local",
      memberships: {
        create: {
          id: "seed-membership-owner",
          role: "OWNER",
          tenant: {
            create: {
              id: "seed-tenant-demo",
              slug: "demo",
              name: "Demo Workspace",
            },
          },
        },
      },
    },
  });

  await prisma.gmailConnection.upsert({
    where: {
      tenantId_googleAccountId: {
        tenantId: "seed-tenant-demo",
        googleAccountId: "demo-google-id",
      },
    },
    update: {},
    create: {
      id: "seed-gmail-demo",
      tenantId: "seed-tenant-demo",
      googleAccountId: "demo-google-id",
      emailAddress: "demo@kotori.local",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      encryptedCredentials: encryptCredentials(
        {
          accessToken: "development-only-token",
          refreshToken: "development-only-refresh",
        },
        seedEncryptionKey,
      ),
      syncState: { create: { id: "seed-sync-demo", historyId: "1000" } },
      threads: {
        create: {
          id: "seed-thread-action",
          tenantId: "seed-tenant-demo",
          gmailThreadId: "gmail-thread-100",
          subject: "Please review the launch checklist",
          snippet: "Could you review the final checklist by Friday?",
          latestMessageAt: new Date("2026-01-15T12:00:00.000Z"),
          isUnread: true,
          labelIds: ["INBOX", "UNREAD"],
          messages: {
            create: {
              id: "seed-message-action",
              gmailMessageId: "gmail-message-100",
              fromAddress: "alex@example.com",
              toAddresses: ["demo@kotori.local"],
              ccAddresses: [],
              sentAt: new Date("2026-01-15T12:00:00.000Z"),
              bodyText: "Could you review the final checklist by Friday?",
            },
          },
          classification: {
            create: {
              id: "seed-classification-action",
              category: "ACTION_REQUIRED",
              confidence: 0.96,
              model: "seed-fixture",
            },
          },
          summary: {
            create: {
              id: "seed-summary-action",
              summary: "Alex requests a review of the launch checklist.",
              requestedActions: ["Review the checklist by Friday"],
              model: "seed-fixture",
            },
          },
        },
      },
    },
  });
}

main().finally(() => prisma.$disconnect());
