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
    actorId: v.id("users"),
  },
  handler: async (ctx, a) => {
    const [thread, identity, user] = await Promise.all([
      ctx.db.get(a.threadId),
      ctx.db.get(a.identityId),
      ctx.db.get(a.actorId),
    ]);
    if (!thread || !identity || !user || identity.userId !== user._id)
      return null;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", thread.tenantId).eq("userId", user._id),
      )
      .unique();
    if (!membership) return null;
    const messages = await ctx.db
      .query("emailMessages")
      .withIndex("by_thread_sent", (q) => q.eq("threadId", a.threadId))
      .collect();
    return { thread, messages, identity };
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
    const [job, thread, user, identity] = await Promise.all([
      ctx.db.get(a.jobId),
      ctx.db.get(a.threadId),
      ctx.db.get(a.actorId),
      ctx.db.get(a.identityId),
    ]);
    if (
      !job ||
      !thread ||
      !user ||
      !identity ||
      job.tenantId !== thread.tenantId ||
      identity.userId !== user._id
    )
      throw new Error("reply_context_not_found");
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", thread.tenantId).eq("userId", user._id),
      )
      .unique();
    if (!membership) throw new Error("reply_context_not_found");

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
        body: normalizedBodies[rank]!,
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
