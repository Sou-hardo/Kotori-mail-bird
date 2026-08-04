import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  decryptAnalysis,
  decryptMessage,
  decryptThread,
  mailboxBox,
  type Box,
} from "./mailCrypto";

// Every AI path needs the same three things: the thread, the mailbox that
// owns it, and that mailbox's key. Resolving them together means the owner
// check can't be forgotten on one branch.
async function mailbox(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"emailThreads">,
) {
  const thread = await ctx.db.get(threadId);
  if (!thread) return null;
  const connection = await ctx.db.get(thread.gmailConnectionId);
  if (!connection?.ownerUserId) return null;
  return { thread, connection, box: mailboxBox(connection) };
}

const decryptMessages = async (
  box: Box,
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"emailThreads">,
) => {
  const out = [];
  for (const message of await ctx.db
    .query("emailMessages")
    .withIndex("by_thread_sent", (q) => q.eq("threadId", threadId))
    .collect())
    out.push(await decryptMessage(box, message));
  return out;
};

export const threadContext = internalQuery({
  args: { threadId: v.id("emailThreads") },
  handler: async (ctx, { threadId }) => {
    const resolved = await mailbox(ctx, threadId);
    if (!resolved) return null;
    return {
      thread: await decryptThread(resolved.box, resolved.thread),
      messages: await decryptMessages(resolved.box, ctx, threadId),
    };
  },
});
export const replyContext = internalQuery({
  args: {
    threadId: v.id("emailThreads"),
    identityId: v.id("identityProfiles"),
    actorId: v.id("users"),
  },
  handler: async (ctx, a) => {
    const [resolved, identity, user] = await Promise.all([
      mailbox(ctx, a.threadId),
      ctx.db.get(a.identityId),
      ctx.db.get(a.actorId),
    ]);
    if (!resolved || !identity || !user || identity.userId !== user._id)
      return null;
    // Owning the mailbox, not sharing a tenant with it, is what grants the
    // AI path access to this thread.
    if (resolved.connection.ownerUserId !== user._id) return null;
    return {
      thread: await decryptThread(resolved.box, resolved.thread),
      messages: await decryptMessages(resolved.box, ctx, a.threadId),
      identity,
    };
  },
});
export const latestAnalysisFor = internalQuery({
  args: { threadId: v.id("emailThreads") },
  handler: async (ctx, { threadId }) => {
    const resolved = await mailbox(ctx, threadId);
    if (!resolved) return null;
    const rows = await ctx.db
      .query("threadAnalyses")
      .withIndex("by_thread_created", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(1);
    return rows[0]
      ? ((await decryptAnalysis(resolved.box, rows[0])).analysis ?? null)
      : null;
  },
});
export const saveAnalysis = internalMutation({
  args: { threadId: v.id("emailThreads"), result: v.any() },
  handler: async (ctx, { threadId, result }) => {
    const resolved = await mailbox(ctx, threadId);
    if (!resolved) throw new Error("thread_not_found");
    const { box } = resolved;
    const now = Date.now(),
      model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    await ctx.db.insert("threadAnalyses", {
      threadId,
      schemaVersion: "1",
      model,
      analysis: (await box.encJson("threadAnalyses.analysis", result))!,
      safetyFlags: (await box.encJson(
        "threadAnalyses.safetyFlags",
        result.reviewReasons ?? [],
      ))!,
      createdAt: now,
    });
    const old = await ctx.db
      .query("classifications")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
    const c = {
      category: result.category ?? "UNKNOWN",
      confidence: Number(result.confidence ?? 0),
      rationale: await box.enc("classifications.rationale", result.summary),
      model,
      updatedAt: now,
    };
    if (old) await ctx.db.patch(old._id, c);
    else
      await ctx.db.insert("classifications", {
        threadId,
        ...c,
        createdAt: now,
      });
    const s = await ctx.db
      .query("threadSummaries")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
    const sd = {
      summary: (await box.enc(
        "threadSummaries.summary",
        String(result.summary ?? ""),
      ))!,
      requestedActions: (await box.encJson(
        "threadSummaries.requestedActions",
        result.actions ?? [],
      ))!,
      model,
      updatedAt: now,
    };
    if (s) await ctx.db.patch(s._id, sd);
    else
      await ctx.db.insert("threadSummaries", {
        threadId,
        ...sd,
        createdAt: now,
      });
  },
});
export const saveReplies = internalMutation({
  args: {
    jobId: v.id("processingJobs"),
    threadId: v.id("emailThreads"),
    actorId: v.id("users"),
    identityId: v.id("identityProfiles"),
    intent: v.string(),
    tone: v.string(),
    length: v.string(),
    acknowledgements: v.array(v.string()),
    suggestionCount: v.union(v.literal(1), v.literal(3)),
    result: v.object({
      options: v.array(v.object({ tone: v.string(), body: v.string() })),
    }),
  },
  handler: async (ctx, a) => {
    const [job, resolved, user, identity] = await Promise.all([
      ctx.db.get(a.jobId),
      mailbox(ctx, a.threadId),
      ctx.db.get(a.actorId),
      ctx.db.get(a.identityId),
    ]);
    if (
      !job ||
      !resolved ||
      !user ||
      !identity ||
      job.tenantId !== resolved.thread.tenantId ||
      identity.userId !== user._id ||
      resolved.connection.ownerUserId !== user._id
    )
      throw new Error("reply_context_not_found");
    const { thread, box } = resolved;

    const jobInput = job.input as
      | {
          actorId?: unknown;
          identityId?: unknown;
          threadId?: unknown;
          suggestionCount?: unknown;
        }
      | undefined;
    if (
      job.kind !== "ai.reply.generate" ||
      jobInput?.actorId !== String(user._id) ||
      jobInput.identityId !== identity._id ||
      jobInput.threadId !== thread._id ||
      jobInput.suggestionCount !== a.suggestionCount
    )
      throw new Error("invalid_reply_job");
    const expectedCount = a.suggestionCount;
    if (a.result.options.length !== expectedCount)
      throw new Error(`invalid_reply_option_count:${expectedCount}`);
    const normalizedBodies = a.result.options.map((option) =>
      option.body.replace(/[<>]/g, "").trim().slice(0, 20_000),
    );
    if (
      normalizedBodies.some((body) => body.length === 0) ||
      new Set(normalizedBodies).size !== expectedCount
    )
      throw new Error("invalid_reply_options");

    const now = Date.now();
    const generationId = await ctx.db.insert("replyGenerations", {
      threadId: a.threadId,
      schemaVersion: "1",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      intent: a.intent,
      tone: a.tone,
      length: a.length,
      identity: `${identity.displayName} <${identity.email}>`,
      closing: identity.closing,
      requiredReviewFlags: [],
      acknowledgedFlags: a.acknowledgements,
      createdAt: now,
      updatedAt: now,
    });
    for (const [rank, option] of a.result.options.entries())
      await ctx.db.insert("replyOptions", {
        threadId: a.threadId,
        generationId,
        tone: option.tone || a.tone,
        body: (await box.enc("replyOptions.body", normalizedBodies[rank]!))!,
        model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
        rank,
        intent: a.intent,
        version: 1,
        createdAt: now,
      });
    await ctx.db.insert("auditEvents", {
      tenantId: thread.tenantId,
      actorId: user._id,
      action: "REPLY_GENERATED",
      targetType: "ReplyGeneration",
      targetId: String(generationId),
      metadata: { optionCount: expectedCount },
      createdAt: now,
    });
    return generationId;
  },
});
