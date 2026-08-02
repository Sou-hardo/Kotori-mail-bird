/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { generalPool, syncPool } from "./pools";
import { dto, requirePrincipal } from "./principal";

const poolFor = (kind: string) =>
  kind === "gmail.sync" ? syncPool : generalPool;

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
    const { tenantId } = await requirePrincipal(ctx);
    const input = args.input as Record<string, unknown>;
    if (typeof input.connectionId === "string") {
      const c = await ctx.db.get(input.connectionId as Id<"gmailConnections">);
      if (!c || c.tenantId !== tenantId)
        throw new Error("connection_not_found");
    }
    if (typeof input.threadId === "string") {
      const t = await ctx.db.get(input.threadId as Id<"emailThreads">);
      if (!t || t.tenantId !== tenantId) throw new Error("thread_not_found");
    }
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

export const start = internalMutation({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !["PENDING", "FAILED"].includes(job.status)) return null;
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
export const complete = generalPool.defineOnComplete({
  context: v.object({ jobId: v.id("processingJobs") }),
  handler: async (ctx, { context, result }) => {
    const job = await ctx.db.get(context.jobId);
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
