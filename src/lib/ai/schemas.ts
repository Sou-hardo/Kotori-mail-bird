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
    tone: z.enum([
      "Professional",
      "Warm professional",
      "Friendly",
      "Direct",
      "Diplomatic",
      "Academic",
    ]),
    length: z.enum(["short", "standard", "detailed"]),
    identityId: z.string().cuid(),
    acknowledgements: z.array(z.string()).max(20).default([]),
  })
  .strict();

export const replyPreferenceSchema = z
  .object({
    generateThreeSuggestions: z.boolean(),
  })
  .strict();

export type ReplySuggestionCount = 1 | 3;

const draftSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(20_000),
  })
  .strict();

function outputSchemaFor(count: ReplySuggestionCount) {
  return z
    .object({
      schemaVersion: z.literal(AI_SCHEMA_VERSION),
      drafts: z.array(draftSchema).length(count),
    })
    .strict()
    .superRefine(({ drafts }, context) => {
      const normalized = drafts.map((draft) =>
        draft.body.toLowerCase().replace(/\s+/g, " ").trim(),
      );
      if (new Set(normalized).size !== drafts.length) {
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
}

export const replyOutputSchemaFor = (count: ReplySuggestionCount) =>
  outputSchemaFor(count);

export const replyOutputSchema = z.union([
  outputSchemaFor(1),
  outputSchemaFor(3),
]);

export type ThreadAnalysisResult = z.infer<typeof analysisSchema>;
export type ReplyRequest = z.infer<typeof replyRequestSchema>;
export type ReplyOutput = z.infer<typeof replyOutputSchema>;
export type ReplyPreference = z.infer<typeof replyPreferenceSchema>;
