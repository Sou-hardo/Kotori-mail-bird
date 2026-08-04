"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { deepSeekJson } from "../src/lib/ai/deepseek";
import {
  analysisPrompt,
  replyPrompt,
  type PromptThread,
} from "../src/lib/ai/prompts";
import {
  AI_SCHEMA_VERSION,
  analysisSchema,
  draftsToOptions,
  replyOutputSchemaFor,
  type ReplyRequest,
  type ThreadAnalysisResult,
} from "../src/lib/ai/schemas";

type ReplyContext = {
  thread: Doc<"emailThreads">;
  messages: Array<Doc<"emailMessages">>;
  identity: Doc<"identityProfiles">;
};

const DEFAULT_ANALYSIS: ThreadAnalysisResult = {
  schemaVersion: AI_SCHEMA_VERSION,
  needsReply: true,
  category: "UNKNOWN",
  urgency: "normal",
  summary: "No prior analysis available.",
  questions: [],
  actions: [],
  dates: [],
  commitments: [],
  suggestedIntents: ["General reply"],
  confidence: 0,
  risk: "low",
  reviewReasons: [],
};

function toPromptThread(thread: {
  subject?: string | null;
  messages: Array<Doc<"emailMessages">>;
}): PromptThread {
  return {
    subject: thread.subject,
    messages: thread.messages.map((m) => ({
      fromAddress: m.fromAddress,
      toAddresses: m.toAddresses,
      ccAddresses: m.ccAddresses,
      sentAt: new Date(m.sentAt),
      bodyText: m.bodyText,
      snippet: m.snippet,
      attachments: [],
    })),
  };
}

export const analyze = internalAction({
  args: {
    jobId: v.id("processingJobs"),
    threadId: v.id("emailThreads"),
    version: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<ThreadAnalysisResult> => {
    const input = await ctx.runQuery(internal.aiData.threadContext, {
      threadId: a.threadId,
    });
    if (!input) throw new Error("thread_not_found");
    const { system, user } = analysisPrompt(
      toPromptThread({
        subject: input.thread.subject,
        messages: input.messages,
      }),
    );
    const result = await deepSeekJson(system, user, analysisSchema);
    await ctx.runMutation(internal.aiData.saveAnalysis, {
      threadId: a.threadId,
      result,
    });
    return result;
  },
});
export const generateReplies = internalAction({
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
  },
  handler: async (ctx, a): Promise<{ count: 1 | 3; generationId: string }> => {
    const input: ReplyContext | null = await ctx.runQuery(
      internal.aiData.replyContext,
      {
        threadId: a.threadId,
        identityId: a.identityId,
        actorId: a.actorId,
      },
    );
    if (!input) throw new Error("reply_context_not_found");
    const expectedCount = a.suggestionCount;

    const storedAnalysis = await ctx.runQuery(
      internal.aiData.latestAnalysisFor,
      {
        threadId: a.threadId,
      },
    );
    const parsedAnalysis = analysisSchema.safeParse(storedAnalysis);
    const analysis = parsedAnalysis.success
      ? parsedAnalysis.data
      : DEFAULT_ANALYSIS;

    const { system, user } = replyPrompt(
      toPromptThread({
        subject: input.thread.subject,
        messages: input.messages,
      }),
      analysis,
      {
        threadId: a.threadId,
        intent: a.intent,
        tone: a.tone as ReplyRequest["tone"],
        length: a.length as ReplyRequest["length"],
        identityId: a.identityId,
        acknowledgements: a.acknowledgements,
        identity: `${input.identity.displayName} <${input.identity.email}>`,
        closing: input.identity.closing,
        signature: input.identity.signature,
      },
      expectedCount,
    );
    const result = await deepSeekJson(
      system,
      user,
      replyOutputSchemaFor(expectedCount),
    );
    const options = draftsToOptions(result.drafts, a.tone);
    const generationId = await ctx.runMutation(internal.aiData.saveReplies, {
      ...a,
      result: { options },
    });
    return { count: expectedCount, generationId };
  },
});
