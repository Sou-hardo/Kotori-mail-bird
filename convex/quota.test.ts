import { describe, expect, it } from "vitest";
import {
  GMAIL_UNIT_COST,
  QUOTA_LIMITS,
  SAFETY_MARGIN,
  checkBudgets,
  floorWindow,
  resolveBudgets,
  windowResetAt,
} from "./quota";

describe("GMAIL_UNIT_COST", () => {
  it("matches the documented Gmail API quota costs", () => {
    expect(GMAIL_UNIT_COST).toEqual({
      "threads.get": 40,
      "threads.list": 10,
      "messages.get": 20,
      "messages.list": 5,
      "history.list": 2,
      getProfile: 1,
      "drafts.list": 5,
      "drafts.create": 10,
      watch: 100,
    });
  });
});

describe("resolveBudgets", () => {
  it("applies the safety margin to the raw quota limits by default", () => {
    const budgets = resolveBudgets({});
    expect(budgets.safetyMargin).toBe(SAFETY_MARGIN);
    expect(budgets.dailyBudget).toBe(
      Math.floor(QUOTA_LIMITS.projectDaily * SAFETY_MARGIN),
    );
    expect(budgets.projectMinuteBudget).toBe(
      Math.floor(QUOTA_LIMITS.projectMinute * SAFETY_MARGIN),
    );
    expect(budgets.userMinuteBudget).toBe(
      Math.floor(QUOTA_LIMITS.userMinute * SAFETY_MARGIN),
    );
  });

  it("honours explicit budget env overrides", () => {
    const budgets = resolveBudgets({
      GMAIL_QUOTA_DAILY_BUDGET: "1000",
      GMAIL_QUOTA_PROJECT_MINUTE_BUDGET: "2000",
      GMAIL_QUOTA_USER_MINUTE_BUDGET: "300",
    });
    expect(budgets.dailyBudget).toBe(1000);
    expect(budgets.projectMinuteBudget).toBe(2000);
    expect(budgets.userMinuteBudget).toBe(300);
  });

  it("honours a safety margin override", () => {
    const budgets = resolveBudgets({ GMAIL_QUOTA_SAFETY_MARGIN: "0.5" });
    expect(budgets.safetyMargin).toBe(0.5);
    expect(budgets.dailyBudget).toBe(
      Math.floor(QUOTA_LIMITS.projectDaily * 0.5),
    );
  });

  it("rejects garbage overrides and falls back to defaults", () => {
    const budgets = resolveBudgets({
      GMAIL_QUOTA_DAILY_BUDGET: "not-a-number",
      GMAIL_QUOTA_PROJECT_MINUTE_BUDGET: "-500",
      GMAIL_QUOTA_USER_MINUTE_BUDGET: "0",
      GMAIL_QUOTA_SAFETY_MARGIN: "NaN",
    });
    expect(budgets.safetyMargin).toBe(SAFETY_MARGIN);
    expect(budgets.dailyBudget).toBe(
      Math.floor(QUOTA_LIMITS.projectDaily * SAFETY_MARGIN),
    );
    expect(budgets.projectMinuteBudget).toBe(
      Math.floor(QUOTA_LIMITS.projectMinute * SAFETY_MARGIN),
    );
    expect(budgets.userMinuteBudget).toBe(
      Math.floor(QUOTA_LIMITS.userMinute * SAFETY_MARGIN),
    );
  });

  it("rejects a safety margin outside (0, 1]", () => {
    expect(
      resolveBudgets({ GMAIL_QUOTA_SAFETY_MARGIN: "1.5" }).safetyMargin,
    ).toBe(SAFETY_MARGIN);
    expect(
      resolveBudgets({ GMAIL_QUOTA_SAFETY_MARGIN: "0" }).safetyMargin,
    ).toBe(SAFETY_MARGIN);
  });
});

describe("floorWindow / windowResetAt", () => {
  it("round-trips for the minute window", () => {
    const now = Date.UTC(2026, 0, 15, 10, 30, 45, 123);
    const start = floorWindow(now, "minute");
    expect(start).toBe(Date.UTC(2026, 0, 15, 10, 30, 0, 0));
    expect(windowResetAt(start, "minute")).toBe(start + 60_000);
  });

  it("round-trips for the day window", () => {
    const now = Date.UTC(2026, 0, 15, 10, 30, 45, 123);
    const start = floorWindow(now, "day");
    expect(start).toBe(Date.UTC(2026, 0, 15, 0, 0, 0, 0));
    expect(windowResetAt(start, "day")).toBe(Date.UTC(2026, 0, 16, 0, 0, 0, 0));
  });

  it("floors correctly across a UTC day boundary", () => {
    const justBeforeMidnight = Date.UTC(2026, 0, 15, 23, 59, 59, 999);
    const justAfterMidnight = Date.UTC(2026, 0, 16, 0, 0, 0, 0);
    expect(floorWindow(justBeforeMidnight, "day")).toBe(
      Date.UTC(2026, 0, 15, 0, 0, 0, 0),
    );
    expect(floorWindow(justAfterMidnight, "day")).toBe(
      Date.UTC(2026, 0, 16, 0, 0, 0, 0),
    );
  });
});

describe("checkBudgets", () => {
  const budgets = {
    safetyMargin: 1,
    dailyBudget: 1000,
    projectMinuteBudget: 100,
    userMinuteBudget: 10,
  };
  const now = 1_000_000;
  const windows = { dayWindowStart: now - 500, minuteWindowStart: now - 5 };

  const cases: Array<{
    name: string;
    usage: {
      dayUnits: number;
      projectMinuteUnits: number;
      minuteUnits: number;
    };
    units: number;
    expectedReason: "project_daily" | "project_minute" | "user_minute";
  }> = [
    {
      name: "daily alone exceeded",
      usage: { dayUnits: 995, projectMinuteUnits: 0, minuteUnits: 0 },
      units: 10,
      expectedReason: "project_daily",
    },
    {
      name: "project-minute alone exceeded",
      usage: { dayUnits: 0, projectMinuteUnits: 95, minuteUnits: 0 },
      units: 10,
      expectedReason: "project_minute",
    },
    {
      name: "user-minute alone exceeded",
      usage: { dayUnits: 0, projectMinuteUnits: 0, minuteUnits: 5 },
      units: 10,
      expectedReason: "user_minute",
    },
  ];

  it.each(cases)(
    "reports $expectedReason when $name",
    ({ usage, units, expectedReason }) => {
      const decision = checkBudgets(usage, units, budgets, now, windows);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toBe(expectedReason);
    },
  );

  it("reports project_daily first when every limit is exceeded simultaneously", () => {
    const decision = checkBudgets(
      { dayUnits: 995, projectMinuteUnits: 95, minuteUnits: 5 },
      10,
      budgets,
      now,
      windows,
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("project_daily");
      expect(decision.retryAfterMs).toBe(
        windowResetAt(windows.dayWindowStart, "day") - now,
      );
    }
  });

  it("allows the reservation when every window has headroom", () => {
    const decision = checkBudgets(
      { dayUnits: 0, projectMinuteUnits: 0, minuteUnits: 0 },
      10,
      budgets,
      now,
      windows,
    );
    expect(decision).toEqual({ ok: true });
  });
});
