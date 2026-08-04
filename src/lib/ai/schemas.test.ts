import { describe, expect, it } from "vitest";
import {
  AI_SCHEMA_VERSION,
  analysisSchema,
  draftsToOptions,
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
      replyOutputSchemaFor(3).safeParse({
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
      replyOutputSchemaFor(1).safeParse({
        schemaVersion: AI_SCHEMA_VERSION,
        drafts: [{ label: "Guided", body: "Thanks, Tuesday works." }],
      }).success,
    ).toBe(true);
    expect(
      replyOutputSchemaFor(3).safeParse({
        schemaVersion: AI_SCHEMA_VERSION,
        drafts: Array.from({ length: 3 }, () => ({
          label: "Same",
          body: "Identical response",
        })),
      }).success,
    ).toBe(false);
    expect(
      replyOutputSchemaFor(3).safeParse({
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
      threadId: "jd7bmxq1k5g9v9dqbe0kwv6crx6y4qsg",
      identityId: "kg2c4nrq6f9x2s0v7de1twy8p3m5z6vh",
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

  it("rejects malformed Convex ids", () => {
    const request = {
      threadId: "jd7bmxq1k5g9v9dqbe0kwv6crx6y4qsg",
      identityId: "kg2c4nrq6f9x2s0v7de1twy8p3m5z6vh",
      intent: "Confirm receipt",
      tone: "Professional",
      length: "short",
      acknowledgements: [],
    };
    expect(
      replyRequestSchema.safeParse({ ...request, threadId: "" }).success,
    ).toBe(false);
    expect(
      replyRequestSchema.safeParse({ ...request, threadId: "not an id!" })
        .success,
    ).toBe(false);
  });

  it("maps drafts to persisted options, using the label as tone", () => {
    expect(
      draftsToOptions(
        [
          { label: "Direct", body: "Thanks, Tuesday works." },
          { label: "", body: "Let's confirm Tuesday." },
        ],
        "Professional",
      ),
    ).toEqual([
      { tone: "Direct", body: "Thanks, Tuesday works." },
      { tone: "Professional", body: "Let's confirm Tuesday." },
    ]);
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
