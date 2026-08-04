// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ownedConnection, ownedConnections, ownedThread } from "./principal";
import { mailboxBox } from "./mailCrypto";

// convex/*.ts is loaded through Vite so convex-test can find the functions.
// `import.meta.glob` is a Vite transform; typing it here avoids pulling
// vite/client into the whole project's tsconfig.
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.ts");

beforeAll(() => {
  process.env.MAIL_ENCRYPTION_KEY =
    "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  process.env.DEEPSEEK_MODEL = "test-model";
});

// One tenant, two members. `owner` connected the mailbox; `coMember` is a
// full OWNER-role member of the same tenant and must still be locked out.
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const tenantId = await ctx.db.insert("tenants", {
      slug: "acme",
      name: "Acme",
      createdAt: now,
      updatedAt: now,
    });
    const owner = await ctx.db.insert("users", {
      authUserId: "auth_owner",
      email: "owner@example.com",
      createdAt: now,
      updatedAt: now,
    });
    const coMember = await ctx.db.insert("users", {
      authUserId: "auth_co",
      email: "co@example.com",
      createdAt: now,
      updatedAt: now,
    });
    for (const userId of [owner, coMember])
      await ctx.db.insert("memberships", {
        tenantId,
        userId,
        role: "OWNER",
        createdAt: now,
      });
    const connectionId = await ctx.db.insert("gmailConnections", {
      tenantId,
      ownerUserId: owner,
      googleAccountId: "g-1",
      emailAddress: "owner@example.com",
      encryptedCredentials: "x",
      scopes: [],
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("syncStates", {
      gmailConnectionId: connectionId,
      status: "IDLE",
      updatedAt: now,
    });
    return { tenantId, owner, coMember, connectionId };
  });
  return { t, ...ids };
}

const GMAIL_MESSAGE = {
  id: "m1",
  internalDate: String(Date.now()),
  labelIds: ["INBOX", "UNREAD"],
  snippet: "quarterly numbers attached",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "Subject", value: "Confidential: Q3 revenue" },
      { name: "From", value: "cfo@example.com" },
      { name: "To", value: "owner@example.com" },
      { name: "Message-ID", value: "<m1@example.com>" },
    ],
    // "Revenue was 4.2M this quarter." base64url encoded
    body: {
      data: "UmV2ZW51ZSB3YXMgNC4yTSB0aGlzIHF1YXJ0ZXIu",
    },
  },
};

const syncOneMessage = async (
  t: Awaited<ReturnType<typeof fixture>>["t"],
  connectionId: Id<"gmailConnections">,
) =>
  t.mutation(internal.gmailData.saveMessage, {
    connectionId,
    gmailThreadId: "t1",
    message: GMAIL_MESSAGE,
  });

describe("mailbox ownership", () => {
  it("resolves a connection only for its owner", async () => {
    const { t, owner, coMember, connectionId } = await fixture();
    await t.run(async (ctx) => {
      expect(await ownedConnection(ctx, owner, connectionId)).not.toBeNull();
      expect(await ownedConnection(ctx, coMember, connectionId)).toBeNull();
      expect(await ownedConnections(ctx, owner)).toHaveLength(1);
      expect(await ownedConnections(ctx, coMember)).toHaveLength(0);
    });
  });

  it("resolves a thread only for the mailbox owner", async () => {
    const { t, owner, coMember, connectionId } = await fixture();
    const threadId = await syncOneMessage(t, connectionId);
    await t.run(async (ctx) => {
      expect(await ownedThread(ctx, owner, threadId)).not.toBeNull();
      expect(await ownedThread(ctx, coMember, threadId)).toBeNull();
    });
  });

  it("rejects a well-formed id belonging to nothing", async () => {
    const { t, owner } = await fixture();
    await t.run(async (ctx) => {
      expect(await ownedConnection(ctx, owner, "not-an-id")).toBeNull();
      expect(await ownedThread(ctx, owner, "not-an-id")).toBeNull();
    });
  });

  it("denies the AI reply path to a tenant co-member", async () => {
    const { t, owner, coMember, connectionId } = await fixture();
    const threadId = await syncOneMessage(t, connectionId);
    const identityId = await t.run((ctx) =>
      ctx.db.insert("identityProfiles", {
        userId: coMember,
        label: "work",
        displayName: "Co Member",
        email: "co@example.com",
        signature: "-- Co",
        closing: "Thanks",
        isDefault: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    expect(
      await t.query(internal.aiData.replyContext, {
        threadId,
        identityId,
        actorId: coMember,
      }),
    ).toBeNull();

    const ownerIdentity = await t.run((ctx) =>
      ctx.db.insert("identityProfiles", {
        userId: owner,
        label: "work",
        displayName: "Owner",
        email: "owner@example.com",
        signature: "-- Owner",
        closing: "Thanks",
        isDefault: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    expect(
      await t.query(internal.aiData.replyContext, {
        threadId,
        identityId: ownerIdentity,
        actorId: owner,
      }),
    ).not.toBeNull();
  });
});

describe("ciphertext at rest", () => {
  it("stores no mailbox plaintext in the synced rows", async () => {
    const { t, connectionId } = await fixture();
    const threadId = await syncOneMessage(t, connectionId);
    const rows = await t.run(async (ctx) => {
      const thread = (await ctx.db.get(threadId))!;
      const messages = await ctx.db
        .query("emailMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadId", threadId))
        .collect();
      return { thread, messages };
    });
    const serialized = JSON.stringify(rows);
    for (const secret of [
      "Confidential: Q3 revenue",
      "quarterly numbers attached",
      "Revenue was 4.2M",
      "cfo@example.com",
    ])
      expect(serialized).not.toContain(secret);

    for (const ciphertext of [
      rows.thread.subject,
      rows.thread.snippet,
      rows.messages[0]!.fromAddress,
      rows.messages[0]!.bodyText,
      rows.messages[0]!.headers,
      rows.messages[0]!.toAddresses,
    ])
      expect(ciphertext).toMatch(/^v1:/);

    // Every string field on a stored message must be ciphertext or a Gmail
    // id -- this is what catches a new plaintext column being added later,
    // the way internetMessageId originally slipped through.
    for (const [key, value] of Object.entries(rows.messages[0]!))
      if (typeof value === "string" && key !== "_id")
        expect(
          value.startsWith("v1:") ||
            ["gmailMessageId", "threadId"].includes(key),
        ).toBe(true);
  });

  it("round-trips back to the original mail through the mailbox key", async () => {
    const { t, connectionId } = await fixture();
    const threadId = await syncOneMessage(t, connectionId);
    const decrypted = await t.run(async (ctx) => {
      const connection = (await ctx.db.get(connectionId))!;
      const box = mailboxBox(connection);
      const thread = (await ctx.db.get(threadId))!;
      const message = (
        await ctx.db
          .query("emailMessages")
          .withIndex("by_thread_sent", (q) => q.eq("threadId", threadId))
          .collect()
      )[0]!;
      return {
        subject: await box.dec("emailThreads.subject", thread.subject),
        from: await box.dec("emailMessages.fromAddress", message.fromAddress),
        body: await box.dec("emailMessages.bodyText", message.bodyText),
        to: await box.decJson<string[]>(
          "emailMessages.toAddresses",
          message.toAddresses,
        ),
      };
    });
    expect(decrypted).toEqual({
      subject: "Confidential: Q3 revenue",
      from: "cfo@example.com",
      body: "Revenue was 4.2M this quarter.",
      to: ["owner@example.com"],
    });
  });

  it("refuses to sync into a mailbox with no owner", async () => {
    const { t, tenantId } = await fixture();
    const orphanId = await t.run((ctx) =>
      ctx.db.insert("gmailConnections", {
        tenantId,
        googleAccountId: "g-2",
        emailAddress: "orphan@example.com",
        encryptedCredentials: "x",
        scopes: [],
        status: "ACTIVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(syncOneMessage(t, orphanId)).rejects.toThrow(
      /connection_missing_owner/,
    );
  });
});
