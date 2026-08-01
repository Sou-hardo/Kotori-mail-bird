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
