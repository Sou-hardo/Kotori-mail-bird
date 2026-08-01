import { z } from "zod";

export const AI_SCHEMA_VERSION = "2026-08-01.v1";

const boundedText = z.string().trim().min(1).max(4_000);
const boundedList = z.array(boundedText.max(500)).max(25);

export const analysisSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    needsReply: z.boolean(),
    category: z.enum([
      "ACTION_REQUIRED",
      "WAITING",
      "FYI",
      "NEWSLETTER",
      "RECEIPT",
      "SPAM",
      "UNKNOWN",
    ]),
    urgency: z.enum(["low", "normal", "high", "critical"]),
    summary: boundedText,
    questions: boundedList,
    actions: boundedList,
    dates: boundedList,
    commitments: boundedList,
    suggestedIntents: boundedList.min(1).max(8),
    confidence: z.number().min(0).max(1),
    risk: z.enum(["low", "medium", "high"]),
    reviewReasons: boundedList,
  })
  .strict();

export const replyRequestSchema = z
  .object({
    threadId: z.string().cuid(),
    intent: z.string().trim().min(1).max(200),
    tone: z.enum(["warm", "professional", "concise", "empathetic", "firm"]),
    length: z.enum(["short", "medium", "long"]),
    identity: z.string().trim().min(1).max(200),
    closing: z.string().trim().min(1).max(200),
    acknowledgements: z.array(z.string()).max(20).default([]),
  })
  .strict();

const draftSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const replyOutputSchema = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    drafts: z.array(draftSchema).length(3),
  })
  .strict()
  .superRefine(({ drafts }, context) => {
    const normalized = drafts.map((draft) =>
      draft.body.toLowerCase().replace(/\s+/g, " ").trim(),
    );
    if (new Set(normalized).size !== 3) {
      context.addIssue({
        code: "custom",
        path: ["drafts"],
        message: "drafts must be meaningfully different",
      });
    }
    for (let left = 0; left < normalized.length; left += 1) {
      for (let right = left + 1; right < normalized.length; right += 1) {
        const a = new Set(normalized[left]!.split(" "));
        const b = new Set(normalized[right]!.split(" "));
        const overlap = [...a].filter((word) => b.has(word)).length;
        const union = new Set([...a, ...b]).size;
        if (union && overlap / union > 0.9) {
          context.addIssue({
            code: "custom",
            path: ["drafts", right],
            message: "drafts are too similar",
          });
        }
      }
    }
  });

export type ThreadAnalysisResult = z.infer<typeof analysisSchema>;
export type ReplyRequest = z.infer<typeof replyRequestSchema>;
export type ReplyOutput = z.infer<typeof replyOutputSchema>;
