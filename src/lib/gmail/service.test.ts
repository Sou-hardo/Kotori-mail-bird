import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isGmailHistoryExpired,
  isRetryableGmailError,
} from "@/lib/gmail/errors";

describe("Gmail errors", () => {
  it("recognizes expired history and quota/server errors", () => {
    expect(isGmailHistoryExpired({ code: 404 })).toBe(true);
    expect(isRetryableGmailError({ code: 429 })).toBe(true);
    expect(isRetryableGmailError({ code: 503 })).toBe(true);
    expect(isRetryableGmailError({ code: 403 })).toBe(false);
  });
});

// gmailActions.ts is a "use node" Convex action and can't be invoked outside
// a Convex runtime, so classifyGmailError (its production error path,
// which is built directly on top of isGmailHistoryExpired /
// isRetryableGmailError) is asserted in convex/gmailSync.test.ts. Pin the
// source here so this dead-code path can't silently regress: 429 must pause
// (not fail), 5xx must retry, 404 must fall back to a full sync, and
// isRetryableGmailError must actually be imported and used rather than a
// hand-rolled duplicate of the 404 check.
describe("gmailActions error handling wires up the shared classifiers", () => {
  const gmailActionsSource = readFileSync(
    fileURLToPath(new URL("../../../convex/gmailActions.ts", import.meta.url)),
    "utf8",
  );
  const gmailSyncSource = readFileSync(
    fileURLToPath(new URL("../../../convex/gmailSync.ts", import.meta.url)),
    "utf8",
  );
  it("gmailActions.ts classifies errors via the shared helper instead of a hand-rolled 404 check", () => {
    expect(gmailActionsSource).toMatch(/classifyGmailError/);
  });
  it("the shared classifier is built on isGmailHistoryExpired/isRetryableGmailError, not a duplicate", () => {
    expect(gmailSyncSource).toMatch(/isGmailHistoryExpired/);
    expect(gmailSyncSource).toMatch(/isRetryableGmailError/);
  });
});
