import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// https://developers.google.com/workspace/gmail/api/reference/quota
export const GMAIL_UNIT_COST: Record<string, number> = {
  "threads.get": 40,
  "threads.list": 10,
  "messages.get": 20,
  "messages.list": 5,
  "history.list": 2,
  getProfile: 1,
  "drafts.list": 5,
  "drafts.create": 10,
  watch: 100,
};

export const QUOTA_LIMITS = {
  projectDaily: 80_000_000,
  projectMinute: 1_200_000,
  userMinute: 6_000,
};

export const SAFETY_MARGIN = 0.85;

type WindowKind = "day" | "minute";

const WINDOW_MS: Record<WindowKind, number> = {
  day: 24 * 60 * 60 * 1000,
  minute: 60 * 1000,
};

export function floorWindow(now: number, kind: WindowKind): number {
  const size = WINDOW_MS[kind];
  return Math.floor(now / size) * size;
}

export function windowResetAt(windowStart: number, kind: WindowKind): number {
  return windowStart + WINDOW_MS[kind];
}

function parsePositiveNumber(
  raw: string | undefined,
  fallback: number,
  max?: number,
): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || (max !== undefined && n > max))
    return fallback;
  return n;
}

function parseSafetyMargin(raw: string | undefined, fallback: number): number {
  return parsePositiveNumber(raw, fallback, 1);
}

export interface QuotaBudgets {
  safetyMargin: number;
  dailyBudget: number;
  projectMinuteBudget: number;
  userMinuteBudget: number;
}

export function resolveBudgets(
  env: Record<string, string | undefined>,
): QuotaBudgets {
  const safetyMargin = parseSafetyMargin(
    env.GMAIL_QUOTA_SAFETY_MARGIN,
    SAFETY_MARGIN,
  );
  const dailyBudget = parsePositiveNumber(
    env.GMAIL_QUOTA_DAILY_BUDGET,
    Math.floor(QUOTA_LIMITS.projectDaily * safetyMargin),
  );
  const projectMinuteBudget = parsePositiveNumber(
    env.GMAIL_QUOTA_PROJECT_MINUTE_BUDGET,
    Math.floor(QUOTA_LIMITS.projectMinute * safetyMargin),
  );
  const userMinuteBudget = parsePositiveNumber(
    env.GMAIL_QUOTA_USER_MINUTE_BUDGET,
    Math.floor(QUOTA_LIMITS.userMinute * safetyMargin),
  );
  return { safetyMargin, dailyBudget, projectMinuteBudget, userMinuteBudget };
}

export interface QuotaWindowUsage {
  dayUnits: number;
  projectMinuteUnits: number;
  minuteUnits: number;
}

export interface QuotaWindows {
  dayWindowStart: number;
  minuteWindowStart: number;
}

export type QuotaDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "user_minute" | "project_minute" | "project_daily";
      retryAfterMs: number;
    };

export function checkBudgets(
  usage: QuotaWindowUsage,
  units: number,
  budgets: QuotaBudgets,
  now: number,
  windows: QuotaWindows,
): QuotaDecision {
  // Order is load-bearing: the first breach wins, so project_daily must be
  // checked before the two minute-scoped windows.
  const checks: {
    reason: "project_daily" | "project_minute" | "user_minute";
    used: number;
    budget: number;
    window: WindowKind;
    windowStart: number;
  }[] = [
    {
      reason: "project_daily",
      used: usage.dayUnits,
      budget: budgets.dailyBudget,
      window: "day",
      windowStart: windows.dayWindowStart,
    },
    {
      reason: "project_minute",
      used: usage.projectMinuteUnits,
      budget: budgets.projectMinuteBudget,
      window: "minute",
      windowStart: windows.minuteWindowStart,
    },
    {
      reason: "user_minute",
      used: usage.minuteUnits,
      budget: budgets.userMinuteBudget,
      window: "minute",
      windowStart: windows.minuteWindowStart,
    },
  ];
  const breach = checks.find((c) => c.used + units > c.budget);
  if (breach)
    return {
      ok: false,
      reason: breach.reason,
      retryAfterMs: windowResetAt(breach.windowStart, breach.window) - now,
    };
  return { ok: true };
}

const PROJECT_SCOPE = "project";

async function getWindowRow(
  ctx: QueryCtx | MutationCtx,
  scope: string,
  windowKind: WindowKind,
  windowStart: number,
) {
  return ctx.db
    .query("quotaUsage")
    .withIndex("by_scope_window", (q) =>
      q
        .eq("scope", scope)
        .eq("windowKind", windowKind)
        .eq("windowStart", windowStart),
    )
    .unique();
}

async function putWindowRow(
  ctx: MutationCtx,
  existing: { _id: Id<"quotaUsage">; units: number } | null,
  scope: string,
  windowKind: WindowKind,
  windowStart: number,
  units: number,
  now: number,
) {
  if (existing)
    await ctx.db.patch(existing._id, {
      units: existing.units + units,
      updatedAt: now,
    });
  else
    await ctx.db.insert("quotaUsage", {
      scope,
      windowKind,
      windowStart,
      units,
      updatedAt: now,
    });
}

export const reserve = internalMutation({
  args: { connectionId: v.id("gmailConnections"), units: v.number() },
  handler: async (ctx, { connectionId, units }) => {
    const now = Date.now();
    const dayWindowStart = floorWindow(now, "day");
    const minuteWindowStart = floorWindow(now, "minute");
    const connectionScope = String(connectionId);
    const budgets = resolveBudgets(process.env);

    const [dayRow, projectMinuteRow, userMinuteRow] = await Promise.all([
      getWindowRow(ctx, PROJECT_SCOPE, "day", dayWindowStart),
      getWindowRow(ctx, PROJECT_SCOPE, "minute", minuteWindowStart),
      getWindowRow(ctx, connectionScope, "minute", minuteWindowStart),
    ]);

    const decision = checkBudgets(
      {
        dayUnits: dayRow?.units ?? 0,
        projectMinuteUnits: projectMinuteRow?.units ?? 0,
        minuteUnits: userMinuteRow?.units ?? 0,
      },
      units,
      budgets,
      now,
      { dayWindowStart, minuteWindowStart },
    );
    if (!decision.ok) return decision;

    await Promise.all([
      putWindowRow(
        ctx,
        dayRow,
        PROJECT_SCOPE,
        "day",
        dayWindowStart,
        units,
        now,
      ),
      putWindowRow(
        ctx,
        projectMinuteRow,
        PROJECT_SCOPE,
        "minute",
        minuteWindowStart,
        units,
        now,
      ),
      putWindowRow(
        ctx,
        userMinuteRow,
        connectionScope,
        "minute",
        minuteWindowStart,
        units,
        now,
      ),
    ]);
    return { ok: true };
  },
});

export async function readUsage(
  ctx: QueryCtx,
  connectionId: Id<"gmailConnections">,
) {
  const now = Date.now();
  const dayWindowStart = floorWindow(now, "day");
  const minuteWindowStart = floorWindow(now, "minute");
  const connectionScope = String(connectionId);
  const budgets = resolveBudgets(process.env);

  const [dayRow, projectMinuteRow, userMinuteRow] = await Promise.all([
    getWindowRow(ctx, PROJECT_SCOPE, "day", dayWindowStart),
    getWindowRow(ctx, PROJECT_SCOPE, "minute", minuteWindowStart),
    getWindowRow(ctx, connectionScope, "minute", minuteWindowStart),
  ]);

  const dayUnits = dayRow?.units ?? 0;
  const dayBudget = budgets.dailyBudget;
  const dayPercent =
    dayBudget === 0 ? 0 : Math.round((dayUnits / dayBudget) * 1000) / 10;

  return {
    dayUnits,
    dayBudget,
    dayPercent,
    minuteUnits: userMinuteRow?.units ?? 0,
    minuteBudget: budgets.userMinuteBudget,
    projectMinuteUnits: projectMinuteRow?.units ?? 0,
    projectMinuteBudget: budgets.projectMinuteBudget,
  };
}

export const usage = internalQuery({
  args: { connectionId: v.id("gmailConnections") },
  handler: async (ctx, { connectionId }) => readUsage(ctx, connectionId),
});

export const prune = internalMutation({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    const rows = await ctx.db
      .query("quotaUsage")
      .filter((q) => q.lt(q.field("windowStart"), before))
      .take(500);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length };
  },
});
