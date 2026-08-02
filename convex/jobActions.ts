"use node";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const run = internalAction({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, { jobId }): Promise<unknown> => {
    const job = await ctx.runMutation(internal.jobs.start, { jobId });
    if (!job) return { deduplicated: true };
    switch (job.kind) {
      case "gmail.sync": {
        const input = job.input as {
          connectionId: Id<"gmailConnections">;
          forceFull: boolean;
        };
        return ctx.runAction(internal.gmailActions.sync, {
          jobId,
          ...input,
        });
      }
      case "gmail.draft.create": {
        const input = job.input as { draftId: Id<"gmailDrafts"> };
        return ctx.runAction(internal.gmailActions.createDraft, {
          jobId,
          ...input,
        });
      }
      case "ai.thread.analyze": {
        const input = job.input as {
          threadId: Id<"emailThreads">;
          version?: string;
        };
        return ctx.runAction(internal.aiActions.analyze, {
          jobId,
          ...input,
        });
      }
      case "ai.reply.generate": {
        const input = job.input as {
          threadId: Id<"emailThreads">;
          actorId: Id<"users">;
          identityId: Id<"identityProfiles">;
          intent: string;
          tone: string;
          length: string;
          acknowledgements: string[];
          suggestionCount: 1 | 3;
        };
        return ctx.runAction(internal.aiActions.generateReplies, {
          jobId,
          ...input,
        });
      }
      case "reminder.due":
        return ctx.runMutation(internal.reminders.fire, job.input as any);
      case "notification.push":
        return ctx.runAction(internal.pushActions.send, job.input as any);
      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
  },
});
