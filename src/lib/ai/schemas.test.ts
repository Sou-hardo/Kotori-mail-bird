import { describe, expect, it } from "vitest";
import {
  AI_SCHEMA_VERSION,
  analysisSchema,
  replyOutputSchema,
  replyOutputSchemaFor,
  replyPreferenceSchema,
  replyRequestSchema,
} from "./schemas";

const analysis = {
  schemaVersion: AI_SCHEMA_VERSION,
  needsReply: true,
  category: "ACTION_REQUIRED",
  urgency: "normal",
  summary: "A response is requested.",
  questions: ["Can we proceed?"],
  actions: ["Reply"],
  dates: [],
  commitments: [],
  suggestedIntents: ["Confirm receipt"],
  confidence: 0.8,
  risk: "low",
  reviewReasons: [],
};

describe("versioned AI schemas", () => {
  it("requires every structured analysis field", () => {
    expect(analysisSchema.parse(analysis)).toEqual(analysis);
    expect(() =>
      analysisSchema.parse({ ...analysis, commitments: undefined }),
    ).toThrow();
    expect(() =>
      analysisSchema.parse({ ...analysis, schemaVersion: "v0" }),
    ).toThrow();
  });

  it("accepts one draft or exactly three distinct drafts", () => {
    expect(
      replyOutputSchema.safeParse({
        schemaVersion: AI_SCHEMA_VERSION,
        drafts: [
          { label: "Direct", body: "Thanks, I can meet Tuesday." },
          {
            label: "Alternative",
            body: "Tuesday works. Please send an invitation.",
          },
          {
            label: "Questions",
            body: "Could we discuss this on Tuesday morning?",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      replyOutputSchema.safeParse({
        schemaVersion: AI_SCHEMA_VERSION,
        drafts: [{ label: "Guided", body: "Thanks, Tuesday works." }],
      }).success,
    ).toBe(true);
    expect(
      replyOutputSchema.safeParse({
        schemaVersion: AI_SCHEMA_VERSION,
        drafts: Array.from({ length: 3 }, () => ({
          label: "Same",
          body: "Identical response",
        })),
      }).success,
    ).toBe(false);
    expect(
      replyOutputSchema.safeParse({
        schemaVersion: AI_SCHEMA_VERSION,
        drafts: [
          { label: "One", body: "First response" },
          { label: "Two", body: "Second response" },
        ],
      }).success,
    ).toBe(false);
    expect(
      replyOutputSchemaFor(3).safeParse({
        schemaVersion: AI_SCHEMA_VERSION,
        drafts: [{ label: "Only", body: "One" }],
      }).success,
    ).toBe(false);
  });

  it("keeps suggestion count out of reply requests", () => {
    const request = {
      threadId: "cm0000000000000000000001",
      identityId: "cm0000000000000000000002",
      intent: "Confirm receipt",
      tone: "Professional",
      length: "short",
      acknowledgements: [],
    };
    expect(replyRequestSchema.safeParse(request).success).toBe(true);
    expect(replyRequestSchema.safeParse({ ...request, count: 3 }).success).toBe(
      false,
    );
  });

  it("accepts only the explicit reply preference shape", () => {
    expect(
      replyPreferenceSchema.parse({ generateThreeSuggestions: false }),
    ).toEqual({ generateThreeSuggestions: false });
    expect(
      replyPreferenceSchema.safeParse({ generateThreeSuggestions: 3 }).success,
    ).toBe(false);
  });
});
