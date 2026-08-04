import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  dto,
  ownedConnection,
  ownedConnections,
  ownedThread,
  requirePrincipal,
} from "./principal";
import {
  decryptAnalysis,
  decryptClassification,
  decryptDraft,
  decryptMessage,
  decryptReplyOption,
  decryptSummary,
  decryptThread,
  mailboxBox,
  userBox,
  type Box,
} from "./mailCrypto";
import { rules as reviewRules } from "../src/lib/ai/review-rules";
import {
  emailAddress as address,
  replyAllRecipients,
} from "../src/lib/gmail/recipients";

// Same shape as dto(gmailConnections row) but never carries the encrypted
// refresh token to a client.
export const connectionDto = (row: Doc<"gmailConnections">) => {
  const { encryptedCredentials, ...rest } = row;
  void encryptedCredentials;
  return dto(rest);
};

export const currentPrincipal = query({
  args: { tenantId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const p = await requirePrincipal(ctx, args.tenantId);
    return { userId: p.userId, tenantId: p.tenantId, user: dto(p.user) };
  },
});

export const getReplyPreference = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requirePrincipal(ctx);
    return {
      generateThreeSuggestions: user.generateThreeSuggestions ?? false,
    };
  },
});

export const setReplyPreference = mutation({
  args: { generateThreeSuggestions: v.boolean() },
  handler: async (ctx, { generateThreeSuggestions }) => {
    const { userId } = await requirePrincipal(ctx);
    await ctx.db.patch(userId, {
      generateThreeSuggestions,
      updatedAt: Date.now(),
    });
    return { generateThreeSuggestions };
  },
});

const INBOX_THREAD_LIMIT = 200;

export const listInbox = query({
  args: { q: v.optional(v.string()), filter: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requirePrincipal(ctx);
    // Threads are reached through the mailboxes this user owns, so a tenant
    // co-member's inbox is not merely filtered out -- it is never read.
    const boxes = new Map<string, Box>();
    const candidates: Doc<"emailThreads">[] = [];
    for (const connection of await ownedConnections(ctx, userId)) {
      boxes.set(String(connection._id), mailboxBox(connection));
      candidates.push(
        ...(await ctx.db
          .query("emailThreads")
          .withIndex("by_connection_latest", (q) =>
            q.eq("gmailConnectionId", connection._id),
          )
          .order("desc")
          .take(INBOX_THREAD_LIMIT)),
      );
    }
    const rows = candidates
      .sort((a, b) => b.latestMessageAt - a.latestMessageAt)
      .slice(0, INBOX_THREAD_LIMIT);
    const needle = args.q?.toLowerCase();
    const output = [];
    for (const encryptedRow of rows) {
      const box = boxes.get(String(encryptedRow.gmailConnectionId))!;
      const row = await decryptThread(box, encryptedRow);
      if (
        !row.labelIds.includes("INBOX") ||
        (args.filter === "unread" && !row.isUnread)
      )
        continue;
      const classification = await ctx.db
        .query("classifications")
        .withIndex("by_thread", (q) => q.eq("threadId", row._id))
        .unique();
      if (
        args.filter === "attention" &&
        classification?.category !== "ACTION_REQUIRED"
      )
        continue;
      // The `q` search needs every message's fromAddress/bodyText, so fetch
      // the full list on that path; otherwise only the newest message is
      // ever returned, so take(1) off the same index.
      const encryptedMessages = needle
        ? await ctx.db
            .query("emailMessages")
            .withIndex("by_thread_sent", (q) => q.eq("threadId", row._id))
            .order("desc")
            .collect()
        : await ctx.db
            .query("emailMessages")
            .withIndex("by_thread_sent", (q) => q.eq("threadId", row._id))
            .order("desc")
            .take(1);
      // ponytail: search decrypts the candidate window in memory and
      // substring-matches, exactly as it did over plaintext. Nothing
      // searchable is persisted in the clear; the cost is O(window) AES-GCM
      // per query. A blind index would be the upgrade if that ever bites --
      // see docs/security/mail-encryption.md.
      const messages = [];
      for (const message of encryptedMessages)
        messages.push(await decryptMessage(box, message));
      const encryptedSummary = await ctx.db
        .query("threadSummaries")
        .withIndex("by_thread", (q) => q.eq("threadId", row._id))
        .unique();
      if (
        needle &&
        ![
          row.subject,
          row.snippet,
          ...messages.flatMap((m) => [m.fromAddress, m.bodyText]),
        ].some((x) => x?.toLowerCase().includes(needle))
      )
        continue;
      output.push({
        ...dto(row),
        messages: messages.slice(0, 1).map(dto),
        classification: classification
          ? dto(await decryptClassification(box, classification))
          : null,
        summary: encryptedSummary
          ? dto(await decryptSummary(box, encryptedSummary))
          : null,
      });
    }
    return output;
  },
});

export const getThread = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { userId } = await requirePrincipal(ctx);
    const owned = await ownedThread(ctx, userId, id);
    if (!owned) return null;
    const { thread, connection } = owned;
    const box = mailboxBox(connection);
    const [messages, summary, classification, generations, identities] =
      await Promise.all([
        ctx.db
          .query("emailMessages")
          .withIndex("by_thread_sent", (q) => q.eq("threadId", thread._id))
          .collect(),
        ctx.db
          .query("threadSummaries")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .unique(),
        ctx.db
          .query("classifications")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .unique(),
        ctx.db
          .query("replyGenerations")
          .withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .take(1),
        ctx.db
          .query("identityProfiles")
          .withIndex("by_user_default", (q) => q.eq("userId", userId))
          .collect(),
      ]);
    const generation = generations[0];
    const options = generation
      ? await ctx.db
          .query("replyOptions")
          .withIndex("by_generation_rank", (q) =>
            q.eq("generationId", generation._id),
          )
          .collect()
      : [];
    const decryptedMessages = [];
    for (const message of messages)
      decryptedMessages.push({
        ...dto(await decryptMessage(box, message)),
        attachments: [],
      });
    const decryptedOptions = [];
    for (const option of options)
      decryptedOptions.push(dto(await decryptReplyOption(box, option)));
    return {
      ...dto(await decryptThread(box, thread)),
      messages: decryptedMessages,
      gmailConnection: connectionDto(connection),
      summary: summary ? dto(await decryptSummary(box, summary)) : null,
      classification: classification
        ? dto(await decryptClassification(box, classification))
        : null,
      replyGenerations: generation
        ? [{ ...dto(generation), options: decryptedOptions }]
        : [],
      identities: identities.map(dto),
    };
  },
});

export const listIdentities = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requirePrincipal(ctx);
    return (
      await ctx.db
        .query("identityProfiles")
        .withIndex("by_user_default", (q) => q.eq("userId", userId))
        .collect()
    )
      .map((identity) => ({
        ...dto(identity),
        role: identity.role ?? null,
        company: identity.company ?? null,
        phone: identity.phone ?? null,
        website: identity.website ?? null,
        pronouns: identity.pronouns ?? null,
      }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  },
});
export const saveIdentity = mutation({
  args: { id: v.optional(v.string()), input: v.any() },
  handler: async (ctx, { id, input }) => {
    const { userId } = await requirePrincipal(ctx);
    const now = Date.now();
    if (input.isDefault)
      for (const x of await ctx.db
        .query("identityProfiles")
        .withIndex("by_user_default", (q) =>
          q.eq("userId", userId).eq("isDefault", true),
        )
        .collect())
        await ctx.db.patch(x._id, { isDefault: false, updatedAt: now });
    if (id) {
      const old = await ctx.db.get(id as Id<"identityProfiles">);
      if (!old || old.userId !== userId) return null;
      await ctx.db.patch(old._id, { ...input, updatedAt: now });
      return dto((await ctx.db.get(old._id))!);
    }
    const duplicate = await ctx.db
      .query("identityProfiles")
      .withIndex("by_user_label", (q) =>
        q.eq("userId", userId).eq("label", input.label),
      )
      .unique();
    if (duplicate) throw new Error("identity_label_exists");
    const newId = await ctx.db.insert("identityProfiles", {
      ...input,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    return dto((await ctx.db.get(newId))!);
  },
});
export const deleteIdentity = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { userId } = await requirePrincipal(ctx);
    const row = await ctx.db.get(id as Id<"identityProfiles">);
    if (row?.userId === userId) await ctx.db.delete(row._id);
  },
});

export const listReminders = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requirePrincipal(ctx);
    const box = userBox(String(userId));
    const out = [];
    for (const reminder of await ctx.db
      .query("followUpReminders")
      .withIndex("by_user_status_due", (q) => q.eq("userId", userId))
      .collect())
      out.push({
        ...dto(reminder),
        title: (await box.dec("followUpReminders.title", reminder.title)) ?? "",
        note: (await box.dec("followUpReminders.note", reminder.note)) ?? null,
      });
    return out.sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  },
});
export const listNotifications = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requirePrincipal(ctx);
    const box = userBox(String(userId));
    const out = [];
    for (const row of await ctx.db
      .query("notifications")
      .withIndex("by_user_read_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50))
      out.push({
        ...dto(row),
        title: (await box.dec("notifications.title", row.title)) ?? "",
        body: (await box.dec("notifications.body", row.body)) ?? "",
      });
    return out;
  },
});
export const listDrafts = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requirePrincipal(ctx);
    const out = [];
    for (const connection of await ownedConnections(ctx, userId)) {
      const box = mailboxBox(connection);
      for (const thread of await ctx.db
        .query("emailThreads")
        .withIndex("by_connection_latest", (q) =>
          q.eq("gmailConnectionId", connection._id),
        )
        .collect())
        for (const draft of await ctx.db
          .query("gmailDrafts")
          .withIndex("by_thread_status", (q) => q.eq("threadId", thread._id))
          .collect())
          out.push({
            ...dto(await decryptDraft(box, draft)),
            thread: dto(await decryptThread(box, thread)),
          });
    }
    return out.sort((a, b) =>
      String((b as Record<string, unknown>).updatedAt).localeCompare(
        String((a as Record<string, unknown>).updatedAt),
      ),
    );
  },
});

export const upsertConnection = mutation({
  args: {
    tenantId: v.string(),
    actorId: v.string(),
    googleAccountId: v.string(),
    emailAddress: v.string(),
    encryptedCredentials: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const p = await requirePrincipal(ctx, args.tenantId);
    if (String(p.userId) !== args.actorId) throw new Error("Forbidden");
    const now = Date.now();
    let row = await ctx.db
      .query("gmailConnections")
      .withIndex("by_tenant_google", (q) =>
        q
          .eq("tenantId", p.tenantId)
          .eq("googleAccountId", args.googleAccountId),
      )
      .unique();
    if (row) {
      // ownerUserId is deliberately absent from this patch: a mailbox never
      // changes hands. A re-connect by a different tenant member updates the
      // credentials but leaves the original owner in place.
      if (row.ownerUserId && row.ownerUserId !== p.userId)
        throw new Error("Forbidden");
      await ctx.db.patch(row._id, {
        ownerUserId: row.ownerUserId ?? p.userId,
        emailAddress: args.emailAddress,
        encryptedCredentials: args.encryptedCredentials,
        scopes: args.scopes,
        status: "ACTIVE",
        lastError: undefined,
        updatedAt: now,
      });
    } else {
      const id = await ctx.db.insert("gmailConnections", {
        tenantId: p.tenantId,
        ownerUserId: p.userId,
        googleAccountId: args.googleAccountId,
        emailAddress: args.emailAddress,
        encryptedCredentials: args.encryptedCredentials,
        scopes: args.scopes,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });
      row = (await ctx.db.get(id))!;
      await ctx.db.insert("syncStates", {
        gmailConnectionId: id,
        status: "IDLE",
        updatedAt: now,
      });
    }
    await ctx.db.insert("auditEvents", {
      tenantId: p.tenantId,
      actorId: p.userId,
      action: "CONNECTION_CREATED",
      targetType: "GmailConnection",
      targetId: String(row._id),
      createdAt: now,
    });
    return dto(row);
  },
});
export const getConnection = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const p = await requirePrincipal(ctx);
    const row = await ownedConnection(ctx, p.userId, id);
    if (!row) return null;
    const sync = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) => q.eq("gmailConnectionId", row._id))
      .unique();
    return { ...connectionDto(row), syncState: sync ? dto(sync) : null };
  },
});
export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const p = await requirePrincipal(ctx);
    const rows = (await ownedConnections(ctx, p.userId)).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    const out = [];
    for (const row of rows) {
      const sync = await ctx.db
        .query("syncStates")
        .withIndex("by_connection", (q) => q.eq("gmailConnectionId", row._id))
        .unique();
      out.push({
        ...connectionDto(row),
        syncState: sync ? dto(sync) : null,
      });
    }
    return out;
  },
});
export const revokeConnection = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const p = await requirePrincipal(ctx);
    const row = await ownedConnection(ctx, p.userId, id);
    if (!row) throw new Error("connection_not_found");
    await ctx.db.patch(row._id, {
      status: "REVOKED",
      encryptedCredentials: "",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditEvents", {
      tenantId: p.tenantId,
      actorId: p.userId,
      action: "CONNECTION_REVOKED",
      targetType: "GmailConnection",
      targetId: String(row._id),
      createdAt: Date.now(),
    });
    return { status: "revoked" };
  },
});
export const latestAnalysis = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const p = await requirePrincipal(ctx);
    const owned = await ownedThread(ctx, p.userId, threadId);
    if (!owned) return null;
    const rows = await ctx.db
      .query("threadAnalyses")
      .withIndex("by_thread_created", (q) => q.eq("threadId", owned.thread._id))
      .order("desc")
      .take(1);
    return rows[0]
      ? dto(await decryptAnalysis(mailboxBox(owned.connection), rows[0]))
      : null;
  },
});

export const replyAction = mutation({
  args: {
    id: v.string(),
    action: v.string(),
    body: v.optional(v.string()),
    reason: v.optional(v.string()),
    acknowledgements: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const p = await requirePrincipal(ctx);
    const encryptedOption = await ctx.db.get(args.id as Id<"replyOptions">);
    if (!encryptedOption) throw new Error("option_not_found");
    const owned = await ownedThread(
      ctx,
      p.userId,
      String(encryptedOption.threadId),
    );
    if (!owned) throw new Error("option_not_found");
    const { thread: encryptedThread, connection } = owned;
    const box = mailboxBox(connection);
    const option = await decryptReplyOption(box, encryptedOption);
    if (!["edit", "reject", "approve"].includes(args.action))
      throw new Error("invalid_action");
    let body = option.body,
      version = option.version,
      auditMetadata: Record<string, unknown> = { version };
    if (args.action === "edit") {
      body = String(args.body ?? "")
        .replace(/[<>]/g, "")
        .slice(0, 20000);
      version++;
      await ctx.db.patch(option._id, {
        body: await box.enc("replyOptions.body", body),
        version,
      });
      auditMetadata = { version, contentChanged: body !== option.body };
    }
    // Audit metadata is stored in the clear, so it records that a rejection
    // happened and how many recipients were involved -- never the reason
    // text or the addresses themselves.
    if (args.action === "reject")
      auditMetadata = { version, reasonLength: (args.reason ?? "").length };
    if (args.action === "approve") {
      const thread = await decryptThread(box, encryptedThread);
      const messages = [];
      for (const message of await ctx.db
        .query("emailMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadId", thread._id))
        .order("desc")
        .collect())
        messages.push(await decryptMessage(box, message));
      const owner = address(connection.emailAddress);
      const inbound = messages.find(
        (message) => address(message.fromAddress) !== owner,
      );
      if (!inbound) throw new Error("no_reply_recipient");
      const recipients = replyAllRecipients(inbound, owner);
      const to = recipients?.to ?? [];
      const cc = recipients?.cc ?? [];
      if (!to.length) throw new Error("no_reply_recipient");
      const generation = option.generationId
        ? await ctx.db.get(option.generationId)
        : null;
      const safetyText = [
        thread.subject,
        ...messages.flatMap((message) => [message.bodyText, message.snippet]),
        generation?.intent,
        generation?.identity,
        generation?.closing,
        option.body,
      ]
        .filter(Boolean)
        .join("\n");
      const requiredReviewFlags = reviewRules
        .filter(([, rule]) => rule.test(safetyText))
        .map(([flag]) => flag);
      if (/\b(?:attach(?:ed|ment)?|enclos(?:ed|ure))\b/i.test(option.body))
        requiredReviewFlags.push("MISSING_ATTACHMENT");
      if (new Set([...to, ...cc].map(address)).size > 1)
        requiredReviewFlags.push("MULTIPLE_RECIPIENTS");
      const required = [...new Set(requiredReviewFlags)];
      const acknowledged = new Set(args.acknowledgements ?? []);
      const missing = required.filter((flag) => !acknowledged.has(flag));
      if (missing.length)
        throw new Error(`review_acknowledgement_required:${missing.join(",")}`);
      if (generation)
        await ctx.db.patch(generation._id, {
          acknowledgedFlags: args.acknowledgements ?? [],
          requiredReviewFlags: required,
          updatedAt: Date.now(),
        });
      auditMetadata = {
        version,
        acknowledgements: [...acknowledged],
        requiredReviewFlags: required,
        recipientCount: to.length + cc.length,
      };
      const existing = await ctx.db
        .query("gmailDrafts")
        .withIndex("by_reply_option", (q) => q.eq("replyOptionId", option._id))
        .unique();
      if (!existing)
        await ctx.db.insert("gmailDrafts", {
          threadId: thread._id,
          replyOptionId: option._id,
          status: "APPROVED",
          body: (await box.enc("gmailDrafts.body", option.body))!,
          toAddresses: (await box.encJson("gmailDrafts.toAddresses", to))!,
          ccAddresses: (await box.encJson("gmailDrafts.ccAddresses", cc))!,
          sourceMessageId: inbound.gmailMessageId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
    }
    await ctx.db.insert("auditEvents", {
      tenantId: p.tenantId,
      actorId: p.userId,
      action:
        args.action === "edit"
          ? "REPLY_EDITED"
          : args.action === "reject"
            ? "REPLY_REJECTED"
            : "REPLY_APPROVED",
      targetType: "ReplyOption",
      targetId: String(option._id),
      metadata: auditMetadata,
      createdAt: Date.now(),
    });
    return { id: option._id, body, version };
  },
});
export const savePush = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePrincipal(ctx);
    const now = Date.now();
    const old = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (old) await ctx.db.patch(old._id, { ...args, userId, updatedAt: now });
    else
      await ctx.db.insert("pushSubscriptions", {
        ...args,
        userId,
        createdAt: now,
        updatedAt: now,
      });
  },
});
export const deletePush = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const { userId } = await requirePrincipal(ctx);
    const old = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (old?.userId === userId) await ctx.db.delete(old._id);
  },
});
