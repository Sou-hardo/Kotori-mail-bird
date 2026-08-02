"use node";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const run = internalAction({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, { jobId }): Promise<unknown> => {
    const job = await ctx.runMutation(internal.jobs.start, { jobId });
    if (!job) return { deduplicated: true };
    switch (job.kind) {
      case "gmail.sync":
        return ctx.runAction(internal.gmailActions.sync, {
          jobId,
          ...(job.input as object),
        });
      case "gmail.draft.create":
        return ctx.runAction(internal.gmailActions.createDraft, {
          jobId,
          ...(job.input as object),
        });
      case "ai.thread.analyze":
        return ctx.runAction(internal.aiActions.analyze, {
          jobId,
          ...(job.input as object),
        });
      case "ai.reply.generate":
        return ctx.runAction(internal.aiActions.generateReplies, {
          jobId,
          ...(job.input as object),
        });
      case "reminder.due":
        return ctx.runMutation(internal.reminders.fire, job.input as any);
      case "notification.push":
        return ctx.runAction(internal.pushActions.send, job.input as any);
      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
  },
});
