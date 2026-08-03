import {
  isGmailHistoryExpired,
  isRetryableGmailError,
} from "../src/lib/gmail/errors";

export const GMAIL_BACKFILL_WINDOW_DAYS_DEFAULT = 180;
export const GMAIL_QUOTA_SHORT_WAIT_THRESHOLD_MS = 60_000;
export const GMAIL_DEFAULT_RETRY_AFTER_MS = 60_000;

export function resolveWindowDays(windowDays: number | undefined): number {
  return windowDays && windowDays > 0
    ? windowDays
    : GMAIL_BACKFILL_WINDOW_DAYS_DEFAULT;
}

export type SyncPhase = "COUNTING" | "BACKFILL" | "INCREMENTAL";

// Phase reflects durable state, not the forceFull request flag: a reset
// connection (no totals yet) is always COUNTING regardless of why it reset.
export function computeInitialPhase(
  state: { backfillDone?: boolean; totalThreads?: number } | null,
): SyncPhase {
  if (state?.backfillDone) return "INCREMENTAL";
  return state?.totalThreads === undefined ? "COUNTING" : "BACKFILL";
}

export function computeBackfillAdvance(
  nextPageToken: string | undefined | null,
): { backfillPageToken: string | undefined; backfillDone: boolean } {
  return nextPageToken
    ? { backfillPageToken: nextPageToken, backfillDone: false }
    : { backfillPageToken: undefined, backfillDone: true };
}

export function parseRetryAfterMs(
  value: string | number | undefined | null,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(String(value));
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

export function extractGmailErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const withCode = error as {
    code?: unknown;
    response?: { status?: unknown };
  };
  const code = withCode.code ?? withCode.response?.status;
  const n = Number(code);
  return Number.isFinite(n) ? n : undefined;
}

function extractRetryAfterHeader(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const withResponse = error as {
    response?: { headers?: Record<string, string> };
  };
  const headers = withResponse.response?.headers;
  return headers?.["retry-after"] ?? headers?.["Retry-After"];
}

export type GmailErrorOutcome =
  | { kind: "fallback_full" }
  | { kind: "pause"; resumeAt: number }
  | { kind: "retry" }
  | { kind: "fail" };

export function classifyGmailError(
  error: unknown,
  now: number,
  defaultRetryAfterMs = GMAIL_DEFAULT_RETRY_AFTER_MS,
): GmailErrorOutcome {
  if (isGmailHistoryExpired(error)) return { kind: "fallback_full" };
  const code = extractGmailErrorCode(error);
  if (code === 429) {
    const retryAfterMs =
      parseRetryAfterMs(extractRetryAfterHeader(error)) ?? defaultRetryAfterMs;
    return { kind: "pause", resumeAt: now + retryAfterMs };
  }
  if (isRetryableGmailError(error)) return { kind: "retry" };
  return { kind: "fail" };
}

export function shouldSkipPollActive(
  state: { resumeAt?: number } | null | undefined,
  now: number,
): boolean {
  return Boolean(state?.resumeAt && state.resumeAt > now);
}
