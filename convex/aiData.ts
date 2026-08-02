/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
export const threadContext = internalQuery({
  args: { threadId: v.id("emailThreads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) return null;
    const messages = await ctx.db
      .query("emailMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadId", threadId))
      .collect();
    return { thread, messages };
  },
});
export const replyContext = internalQuery({
  args: {
    threadId: v.id("emailThreads"),
    identityId: v.id("identityProfiles"),
  },
  handler: async (ctx, a) => {
    const base = await ctx.db.get(a.threadId),
      identity = await ctx.db.get(a.identityId);
    if (!base || !identity) return null;
    const messages = await ctx.db
      .query("emailMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadId", a.threadId))
      .collect();
    return { thread: base, messages, identity };
  },
});
export const saveAnalysis = internalMutation({
  args: { threadId: v.id("emailThreads"), result: v.any() },
  handler: async (ctx, { threadId, result }) => {
    const now = Date.now(),
      model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    await ctx.db.insert("threadAnalyses", {
      threadId,
      schemaVersion: "1",
      model,
      analysis: result,
      safetyFlags: result.safetyFlags ?? [],
      createdAt: now,
    });
    const old = await ctx.db
      .query("classifications")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
    const c = {
      category: result.category ?? "UNKNOWN",
      confidence: Number(result.confidence ?? 0),
      rationale: result.rationale,
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
      summary: String(result.summary ?? ""),
      requestedActions: result.requestedActions ?? [],
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
    actorId: v.string(),
    identityId: v.string(),
    intent: v.string(),
    tone: v.string(),
    length: v.string(),
    acknowledgements: v.array(v.string()),
    result: v.any(),
  },
  handler: async (ctx, a) => {
    const now = Date.now(),
      identity = await ctx.db.get(a.identityId as any);
    const generationId = await ctx.db.insert("replyGenerations", {
      threadId: a.threadId,
      schemaVersion: "1",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      intent: a.intent,
      tone: a.tone,
      length: a.length,
      identity: identity
        ? `${(identity as any).displayName} <${(identity as any).email}>`
        : "",
      closing: (identity as any)?.closing ?? "",
      requiredReviewFlags: [],
      acknowledgedFlags: a.acknowledgements,
      createdAt: now,
      updatedAt: now,
    });
    for (const [rank, o] of (a.result.options ?? []).slice(0, 3).entries())
      await ctx.db.insert("replyOptions", {
        threadId: a.threadId,
        generationId,
        tone: o.tone ?? a.tone,
        body: String(o.body ?? "").replace(/<[^>]*>/g, ""),
        model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
        rank,
        intent: a.intent,
        version: 1,
        createdAt: now,
      });
    return generationId;
  },
});
