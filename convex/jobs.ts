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
  userId: Id<"users">,
) {
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
  if (kind === "ai.reply.generate") input.actorId = String(userId);
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
    const { tenantId, userId } = await requirePrincipal(ctx);
    const input = args.input as Record<string, unknown>;
    await authorizeJobInput(ctx, args.kind, input, tenantId, userId);
    return dto(
      await createJob(
        ctx,
        tenantId,
        args.kind,
        args.input,
        args.dedupeKey,
        args.runAt,
      ),
    );
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
  args: {},
  handler: async (ctx) => {
    for (const c of await ctx.db.query("gmailConnections").collect()) {
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
  },
});
export const retentionBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const cutoff = Date.now() - 90 * 86400000;
    const page = await ctx.db
      .query("emailThreads")
      .paginate({ cursor: cursor ?? null, numItems: 50 });
    for (const t of page.page)
      if (t.latestMessageAt < cutoff) {
        for (const row of await ctx.db
          .query("classifications")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect())
          await ctx.db.delete(row._id);
        for (const row of await ctx.db
          .query("threadSummaries")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect())
          await ctx.db.delete(row._id);
        for (const row of await ctx.db
          .query("threadAnalyses")
          .withIndex("by_thread_created", (q) => q.eq("threadId", t._id))
          .collect())
          await ctx.db.delete(row._id);
        for (const row of await ctx.db
          .query("gmailDrafts")
          .withIndex("by_thread_status", (q) => q.eq("threadId", t._id))
          .collect())
          await ctx.db.delete(row._id);
        for (const row of await ctx.db
          .query("followUpReminders")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect()) {
          if (row.scheduledWorkId)
            await generalPool.cancel(ctx, row.scheduledWorkId as any);
          await ctx.db.delete(row._id);
        }
        for (const row of await ctx.db
          .query("notifications")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect())
          await ctx.db.delete(row._id);
        for (const generation of await ctx.db
          .query("replyGenerations")
          .withIndex("by_thread_created", (q) => q.eq("threadId", t._id))
          .collect()) {
          for (const option of await ctx.db
            .query("replyOptions")
            .withIndex("by_generation_rank", (q) =>
              q.eq("generationId", generation._id),
            )
            .collect())
            await ctx.db.delete(option._id);
          await ctx.db.delete(generation._id);
        }
        for (const option of await ctx.db
          .query("replyOptions")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect())
          await ctx.db.delete(option._id);
        for (const m of await ctx.db
          .query("emailMessages")
          .withIndex("by_thread_sent", (q) => q.eq("threadId", t._id))
          .collect()) {
          for (const a of await ctx.db
            .query("attachments")
            .withIndex("by_message_gmail", (q) => q.eq("messageId", m._id))
            .collect())
            await ctx.db.delete(a._id);
          await ctx.db.delete(m._id);
        }
        await ctx.db.delete(t._id);
      }
    for (const job of await ctx.db.query("processingJobs").collect())
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
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.jobs.retentionBatch, {
        cursor: page.continueCursor,
      });
    return {
      deleted: page.page.filter((t) => t.latestMessageAt < cutoff).length,
    };
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
        .withIndex("by_tenant_kind_dedupe", (q) =>
          q.eq("tenantId", tenantId).eq("kind", "gmail.sync"),
        )
        .order("desc")
        .take(20)
    )
      .filter((j) => (j.input as any)?.connectionId === connectionId)
      .slice(0, 10);
    return {
      connection: dto(connection),
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
