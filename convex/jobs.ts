/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id, DataModel } from "./_generated/dataModel";
import { generalPool, syncPool } from "./pools";
import { dto, requirePrincipal } from "./principal";

const poolFor = (kind: string) =>
  kind === "gmail.sync" ? syncPool : generalPool;

const publicKinds = new Set([
  "gmail.sync",
  "gmail.draft.create",
  "ai.thread.analyze",
  "ai.reply.generate",
]);

async function authorizeJobInput(
  ctx: any,
  kind: string,
  input: Record<string, unknown>,
  tenantId: Id<"tenants">,
  user: Doc<"users">,
): Promise<Record<string, unknown>> {
  const userId = user._id;
  const authorizedInput = { ...input };
  if (!publicKinds.has(kind)) throw new Error("job_kind_not_allowed");
  if (typeof input.connectionId === "string") {
    const row = await ctx.db.get(input.connectionId as Id<"gmailConnections">);
    if (!row || row.tenantId !== tenantId)
      throw new Error("connection_not_found");
  }
  let thread: Doc<"emailThreads"> | null = null;
  if (typeof input.threadId === "string") {
    thread = await ctx.db.get(input.threadId as Id<"emailThreads">);
    if (!thread || thread.tenantId !== tenantId)
      throw new Error("thread_not_found");
  }
  if (typeof input.identityId === "string") {
    const row = await ctx.db.get(input.identityId as Id<"identityProfiles">);
    if (!row || row.userId !== userId) throw new Error("identity_not_found");
  }
  if (typeof input.draftId === "string") {
    const draft = await ctx.db.get(input.draftId as Id<"gmailDrafts">);
    const draftThread = draft ? await ctx.db.get(draft.threadId) : null;
    if (!draft || !draftThread || draftThread.tenantId !== tenantId)
      throw new Error("draft_not_found");
  }
  if (kind === "ai.reply.generate") {
    const requiredString = (key: string) => {
      const value = input[key];
      if (typeof value !== "string" || value.length === 0)
        throw new Error(`invalid_${key}`);
      return value;
    };
    const acknowledgements = input.acknowledgements;
    if (
      !Array.isArray(acknowledgements) ||
      !acknowledgements.every((value) => typeof value === "string")
    )
      throw new Error("invalid_acknowledgements");
    return {
      threadId: requiredString("threadId"),
      identityId: requiredString("identityId"),
      intent: requiredString("intent"),
      tone: requiredString("tone"),
      length: requiredString("length"),
      acknowledgements,
      actorId: userId,
      suggestionCount: user.generateThreeSuggestions === true ? 3 : 1,
    };
  }
  return authorizedInput;
}

async function createJob(
  ctx: any,
  tenantId: Id<"tenants">,
  kind: string,
  input: unknown,
  dedupeKey?: string,
  runAt?: number,
) {
  if (dedupeKey) {
    const old = await ctx.db
      .query("processingJobs")
      .withIndex("by_tenant_kind_dedupe", (q: any) =>
        q.eq("tenantId", tenantId).eq("kind", kind).eq("dedupeKey", dedupeKey),
      )
      .unique();
    if (old) return old;
  }
  const now = Date.now();
  const jobId = await ctx.db.insert("processingJobs", {
    tenantId,
    kind,
    dedupeKey,
    status: "PENDING",
    input,
    attempts: 0,
    maxAttempts: 5,
    scheduledAt: runAt ?? now,
    createdAt: now,
    updatedAt: now,
  });
  const workId = await poolFor(kind).enqueueAction(
    ctx,
    internal.jobActions.run,
    { jobId },
    {
      retry: true,
      onComplete: internal.jobs.complete,
      context: { jobId },
      ...(runAt ? { runAt } : {}),
    },
  );
  await ctx.db.patch(jobId, { workId: String(workId), updatedAt: Date.now() });
  return (await ctx.db.get(jobId))!;
}

export const enqueue = mutation({
  args: {
    kind: v.string(),
    input: v.any(),
    dedupeKey: v.optional(v.string()),
    runAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { tenantId, user } = await requirePrincipal(ctx);
    const input = await authorizeJobInput(
      ctx,
      args.kind,
      args.input as Record<string, unknown>,
      tenantId,
      user,
    );
    const job = await createJob(
      ctx,
      tenantId,
      args.kind,
      input,
      args.kind === "ai.reply.generate" && args.dedupeKey
        ? `${user._id}:${args.dedupeKey}`
        : args.dedupeKey,
      args.runAt,
    );
    return { id: job._id, status: job.status };
  },
});

export const enqueueInternal = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    kind: v.string(),
    input: v.any(),
    dedupeKey: v.optional(v.string()),
    runAt: v.optional(v.number()),
  },
  handler: (ctx, args) =>
    createJob(
      ctx,
      args.tenantId,
      args.kind,
      args.input,
      args.dedupeKey,
      args.runAt,
    ),
});

export const result = query({
  args: { jobId: v.string(), threadId: v.string() },
  handler: async (ctx, { jobId, threadId }) => {
    const { tenantId, userId } = await requirePrincipal(ctx);
    const id = ctx.db.normalizeId("processingJobs", jobId);
    const expectedThreadId = ctx.db.normalizeId("emailThreads", threadId);
    if (!id || !expectedThreadId) return null;
    const job = await ctx.db.get(id);
    if (!job || job.tenantId !== tenantId) return null;
    if (job.kind !== "ai.reply.generate") return null;
    const input = job.input as
      { actorId?: unknown; threadId?: unknown } | undefined;
    if (
      input?.actorId !== String(userId) ||
      input.threadId !== expectedThreadId
    )
      return null;
    let options: ReturnType<typeof dto>[] | undefined;
    let requiredReviewFlags: string[] | undefined;
    if (job.status === "SUCCEEDED") {
      const generationId = ctx.db.normalizeId(
        "replyGenerations",
        String(
          (job.output as { generationId?: unknown } | undefined)
            ?.generationId ?? "",
        ),
      );
      const generation = generationId ? await ctx.db.get(generationId) : null;
      if (!generation || generation.threadId !== expectedThreadId) return null;
      options = (
        await ctx.db
          .query("replyOptions")
          .withIndex("by_generation_rank", (q) =>
            q.eq("generationId", generation._id),
          )
          .collect()
      ).map(dto);
      requiredReviewFlags = generation.requiredReviewFlags;
    }
    return {
      id: job._id,
      status: job.status,
      ...(job.error === undefined ? {} : { error: job.error }),
      ...(options === undefined ? {} : { options }),
      ...(requiredReviewFlags === undefined ? {} : { requiredReviewFlags }),
    };
  },
});

export const start = internalMutation({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    // A retry re-enters this action with the same durable Workpool item.
    if (!job || !["PENDING", "FAILED", "RUNNING"].includes(job.status))
      return null;
    await ctx.db.patch(jobId, {
      status: "RUNNING",
      attempts: job.attempts + 1,
      startedAt: Date.now(),
      error: undefined,
      updatedAt: Date.now(),
    });
    return { ...job, attempts: job.attempts + 1 };
  },
});
const completionContext = v.object({ jobId: v.id("processingJobs") });
export const complete = generalPool.defineOnComplete<
  DataModel,
  typeof completionContext
>({
  context: completionContext,
  handler: async (ctx, { context, result }) => {
    const job: Doc<"processingJobs"> | null = await ctx.db.get(context.jobId);
    if (!job) return;
    const now = Date.now();
    if (result.kind === "success")
      await ctx.db.patch(job._id, {
        status: "SUCCEEDED",
        output: result.returnValue,
        completedAt: now,
        updatedAt: now,
      });
    else if (result.kind === "canceled")
      await ctx.db.patch(job._id, {
        status: "CANCELLED",
        completedAt: now,
        updatedAt: now,
      });
    else
      await ctx.db.patch(job._id, {
        status: job.attempts >= job.maxAttempts ? "DEAD_LETTER" : "FAILED",
        error: result.error,
        completedAt: job.attempts >= job.maxAttempts ? now : undefined,
        updatedAt: now,
      });
  },
});

export const pollActiveConnections = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("gmailConnections")
      .paginate({ cursor: cursor ?? null, numItems: 50 });
    for (const c of page.page) {
      if (c.status !== "ACTIVE") continue;
      const bucket = Math.floor(Date.now() / 300000);
      await createJob(
        ctx,
        c.tenantId,
        "gmail.sync",
        { connectionId: c._id, forceFull: false },
        `${c._id}:${bucket}`,
      );
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.jobs.pollActiveConnections, {
        cursor: page.continueCursor,
      });
  },
});
export const retentionBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    threadId: v.optional(v.id("emailThreads")),
  },
  handler: async (ctx, { cursor, threadId }) => {
    const cutoff = Date.now() - 90 * 86400000;
    const page = threadId
      ? null
      : await ctx.db
          .query("emailThreads")
          .paginate({ cursor: cursor ?? null, numItems: 1 });
    const thread = threadId ? await ctx.db.get(threadId) : page?.page[0];
    let deleted = 0;
    if (thread && thread.latestMessageAt < cutoff) {
      const reschedule = async () =>
        ctx.scheduler.runAfter(0, internal.jobs.retentionBatch, {
          cursor,
          threadId: thread._id,
        });
      const simpleChildren = [
        await ctx.db
          .query("classifications")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .take(100),
        await ctx.db
          .query("threadSummaries")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .take(100),
        await ctx.db
          .query("threadAnalyses")
          .withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
          .take(100),
        await ctx.db
          .query("gmailDrafts")
          .withIndex("by_thread_status", (q) => q.eq("threadId", thread._id))
          .take(100),
        await ctx.db
          .query("notifications")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .take(100),
      ];
      const firstChildren = simpleChildren.find((rows) => rows.length);
      if (firstChildren) {
        for (const row of firstChildren) await ctx.db.delete(row._id);
        await reschedule();
        return { deleted };
      }
      const reminders = await ctx.db
        .query("followUpReminders")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(50);
      if (reminders.length) {
        for (const row of reminders) {
          if (row.scheduledWorkId)
            await generalPool.cancel(ctx, row.scheduledWorkId as any);
          await ctx.db.delete(row._id);
        }
        await reschedule();
        return { deleted };
      }
      const options = await ctx.db
        .query("replyOptions")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(100);
      if (options.length) {
        for (const row of options) await ctx.db.delete(row._id);
        await reschedule();
        return { deleted };
      }
      const generations = await ctx.db
        .query("replyGenerations")
        .withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
        .take(100);
      if (generations.length) {
        for (const row of generations) await ctx.db.delete(row._id);
        await reschedule();
        return { deleted };
      }
      const messages = await ctx.db
        .query("emailMessages")
        .withIndex("by_thread_sent", (q) => q.eq("threadId", thread._id))
        .take(25);
      if (messages.length) {
        for (const message of messages) {
          const attachments = await ctx.db
            .query("attachments")
            .withIndex("by_message_gmail", (q) =>
              q.eq("messageId", message._id),
            )
            .take(100);
          for (const attachment of attachments)
            await ctx.db.delete(attachment._id);
          if (attachments.length < 100) await ctx.db.delete(message._id);
        }
        await reschedule();
        return { deleted };
      }
      await ctx.db.delete(thread._id);
      deleted = 1;
      if (threadId)
        await ctx.scheduler.runAfter(0, internal.jobs.retentionBatch, {
          cursor,
        });
    }
    for (const job of await ctx.db
      .query("processingJobs")
      .withIndex("by_completed", (q) => q.lt("completedAt", cutoff))
      .take(100))
      if (
        ["SUCCEEDED", "CANCELLED"].includes(job.status) &&
        (job.completedAt ?? Infinity) < cutoff
      )
        await ctx.db.delete(job._id);
    const auditCutoff = Date.now() - 365 * 86400000;
    for (const audit of await ctx.db
      .query("auditEvents")
      .withIndex("by_created", (q) => q.lt("createdAt", auditCutoff))
      .take(100))
      await ctx.db.delete(audit._id);
    if (page && !page.isDone)
      await ctx.scheduler.runAfter(0, internal.jobs.retentionBatch, {
        cursor: page.continueCursor,
      });
    return { deleted };
  },
});
export const status = query({
  args: { connectionId: v.string() },
  handler: async (ctx, { connectionId }) => {
    const { tenantId } = await requirePrincipal(ctx);
    const connection = await ctx.db.get(connectionId as Id<"gmailConnections">);
    if (!connection || connection.tenantId !== tenantId) return null;
    const sync = await ctx.db
      .query("syncStates")
      .withIndex("by_connection", (q) =>
        q.eq("gmailConnectionId", connection._id),
      )
      .unique();
    const jobs = (
      await ctx.db
        .query("processingJobs")
        .withIndex("by_tenant_kind_created", (q) =>
          q.eq("tenantId", tenantId).eq("kind", "gmail.sync"),
        )
        .order("desc")
        .take(200)
    )
      .filter((j) => (j.input as any)?.connectionId === connectionId)
      .slice(0, 10);
    return {
      sync: sync ? dto(sync) : null,
      jobs: jobs.map(dto),
    };
  },
});

export const saveReminder = mutation({
  args: { id: v.optional(v.string()), input: v.any() },
  handler: async (ctx, { id, input }) => {
    const { userId, tenantId } = await requirePrincipal(ctx);
    const now = Date.now();
    if (input.threadId) {
      const t = await ctx.db.get(input.threadId as Id<"emailThreads">);
      if (!t || t.tenantId !== tenantId) throw new Error("thread_not_found");
    }
    let reminderId: Id<"followUpReminders">;
    if (id) {
      const old = await ctx.db.get(id as Id<"followUpReminders">);
      if (!old || old.userId !== userId) return null;
      if (old.scheduledWorkId)
        await generalPool.cancel(ctx, old.scheduledWorkId as any);
      await ctx.db.patch(old._id, { ...input, updatedAt: now });
      reminderId = old._id;
    } else
      reminderId = await ctx.db.insert("followUpReminders", {
        ...input,
        userId,
        status: input.status ?? "OPEN",
        createdAt: now,
        updatedAt: now,
      });
    const row = (await ctx.db.get(reminderId))!;
    if (row.status !== "DONE") {
      const job = await createJob(
        ctx,
        tenantId,
        "reminder.due",
        { reminderId },
        `${reminderId}:${row.updatedAt}`,
        row.dueAt,
      );
      await ctx.db.patch(reminderId, { scheduledWorkId: job.workId });
    }
    return dto((await ctx.db.get(reminderId))!);
  },
});
export const deleteReminder = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { userId } = await requirePrincipal(ctx);
    const row = await ctx.db.get(id as Id<"followUpReminders">);
    if (row?.userId !== userId) return;
    if (row.scheduledWorkId)
      await generalPool.cancel(ctx, row.scheduledWorkId as any);
    await ctx.db.delete(row._id);
  },
});
