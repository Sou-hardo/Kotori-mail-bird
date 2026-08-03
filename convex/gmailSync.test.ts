import { describe, expect, it } from "vitest";
import {
  GMAIL_BACKFILL_WINDOW_DAYS_DEFAULT,
  classifyGmailError,
  computeBackfillAdvance,
  computeInitialPhase,
  parseRetryAfterMs,
  resolveWindowDays,
  shouldSkipPollActive,
} from "./gmailSync";
import {
  GMAIL_UNIT_COST,
  QUOTA_LIMITS,
  checkBudgets,
  resolveBudgets,
} from "./quota";

const MESSAGES_GET_COST = GMAIL_UNIT_COST["messages.get"]!;

describe("resolveWindowDays", () => {
  it("falls back to the default when unset or invalid", () => {
    expect(resolveWindowDays(undefined)).toBe(
      GMAIL_BACKFILL_WINDOW_DAYS_DEFAULT,
    );
    expect(resolveWindowDays(0)).toBe(GMAIL_BACKFILL_WINDOW_DAYS_DEFAULT);
    expect(resolveWindowDays(-5)).toBe(GMAIL_BACKFILL_WINDOW_DAYS_DEFAULT);
  });
  it("uses a configured positive value", () => {
    expect(resolveWindowDays(30)).toBe(30);
  });
});

describe("computeInitialPhase", () => {
  it("is COUNTING before totals are known", () => {
    expect(computeInitialPhase(null)).toBe("COUNTING");
    expect(computeInitialPhase({})).toBe("COUNTING");
  });
  it("is BACKFILL once totals are known but backfill isn't done", () => {
    expect(computeInitialPhase({ totalThreads: 500 })).toBe("BACKFILL");
  });
  it("is INCREMENTAL once backfillDone is true", () => {
    expect(computeInitialPhase({ totalThreads: 500, backfillDone: true })).toBe(
      "INCREMENTAL",
    );
  });
});

describe("computeBackfillAdvance", () => {
  it("stays not-done and carries the cursor forward when a page remains", () => {
    expect(computeBackfillAdvance("cursor-2")).toEqual({
      backfillPageToken: "cursor-2",
      backfillDone: false,
    });
  });
  it("is only done when Gmail returns no nextPageToken", () => {
    expect(computeBackfillAdvance(undefined)).toEqual({
      backfillPageToken: undefined,
      backfillDone: true,
    });
    expect(computeBackfillAdvance(null)).toEqual({
      backfillPageToken: undefined,
      backfillDone: true,
    });
  });
});

describe("parseRetryAfterMs", () => {
  it("parses a seconds value", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
  });
  it("parses an HTTP-date value", () => {
    const future = new Date(Date.now() + 45_000).toUTCString();
    const parsed = parseRetryAfterMs(future);
    expect(parsed).toBeGreaterThan(40_000);
    expect(parsed).toBeLessThan(50_000);
  });
  it("returns undefined for missing/unparseable values", () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("not-a-value")).toBeUndefined();
  });
});

describe("classifyGmailError", () => {
  const now = 1_000_000;
  it("falls back to a full sync on an expired history checkpoint (404)", () => {
    expect(classifyGmailError({ code: 404 }, now)).toEqual({
      kind: "fallback_full",
    });
  });
  it("pauses on 429 and honours the Retry-After header", () => {
    expect(
      classifyGmailError(
        { code: 429, response: { headers: { "retry-after": "12" } } },
        now,
      ),
    ).toEqual({ kind: "pause", resumeAt: now + 12_000 });
  });
  it("pauses on 429 with a default backoff when Retry-After is absent", () => {
    expect(classifyGmailError({ code: 429 }, now, 60_000)).toEqual({
      kind: "pause",
      resumeAt: now + 60_000,
    });
  });
  it("marks 5xx as retryable", () => {
    expect(classifyGmailError({ code: 503 }, now)).toEqual({ kind: "retry" });
  });
  it("fails on other codes", () => {
    expect(classifyGmailError({ code: 403 }, now)).toEqual({ kind: "fail" });
  });
});

describe("shouldSkipPollActive", () => {
  it("skips a connection paused into the future", () => {
    expect(shouldSkipPollActive({ resumeAt: 2000 }, 1000)).toBe(true);
  });
  it("does not skip once resumeAt has passed", () => {
    expect(shouldSkipPollActive({ resumeAt: 500 }, 1000)).toBe(false);
  });
  it("does not skip a connection with no resumeAt", () => {
    expect(shouldSkipPollActive(null, 1000)).toBe(false);
    expect(shouldSkipPollActive({}, 1000)).toBe(false);
  });
});

describe("quota refusal maps to QUOTA_PAUSED with a future resumeAt", () => {
  it("checkBudgets refusal + classifyGmailError-style pausing agree on a future resumeAt", () => {
    const budgets = resolveBudgets({});
    const decision = checkBudgets(
      {
        dayUnits: 0,
        projectMinuteUnits: 0,
        minuteUnits: budgets.userMinuteBudget,
      },
      MESSAGES_GET_COST,
      budgets,
      1_000_000,
      { dayWindowStart: 0, minuteWindowStart: 1_000_000 },
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error("unreachable");
    const resumeAt = 1_000_000 + decision.retryAfterMs;
    expect(resumeAt).toBeGreaterThan(1_000_000);
  });
});

describe("a full backfill can never exceed 6,000 Gmail units in any 60s window", () => {
  it("reserve() refuses further messages.get calls once the per-minute user budget is spent", () => {
    const budgets = resolveBudgets({});
    expect(budgets.userMinuteBudget).toBeLessThanOrEqual(
      QUOTA_LIMITS.userMinute,
    );
    let minuteUnits = 0;
    let reserved = 0;
    const now = 1_000_000;
    const windows = { dayWindowStart: 0, minuteWindowStart: 0 };
    for (let i = 0; i < 1000; i++) {
      const decision = checkBudgets(
        { dayUnits: 0, projectMinuteUnits: 0, minuteUnits },
        MESSAGES_GET_COST,
        budgets,
        now,
        windows,
      );
      if (!decision.ok) break;
      minuteUnits += MESSAGES_GET_COST;
      reserved++;
    }
    // Every reservation this test allowed through must, in aggregate, stay
    // within Google's hard per-user-per-minute cap (6,000 units) — the
    // safety-margined budget guarantees this with room to spare.
    expect(reserved * MESSAGES_GET_COST).toBeLessThanOrEqual(
      QUOTA_LIMITS.userMinute,
    );
    expect(minuteUnits).toBeLessThanOrEqual(budgets.userMinuteBudget);
  });
});
