export function progressPercent(
  imported?: number,
  total?: number,
): number | null {
  if (total === undefined || total === null || total <= 0) return null;
  if (imported === undefined || imported === null) return null;
  const pct = (imported / total) * 100;
  return Math.min(100, Math.max(0, pct));
}

export function remaining(imported?: number, total?: number): number | null {
  if (total === undefined || total === null) return null;
  if (imported === undefined || imported === null) return null;
  return Math.max(0, total - imported);
}

const PHASE_LABELS: Record<string, string> = {
  IDLE: "Idle",
  COUNTING: "Counting mailbox size…",
  BACKFILL: "Importing mail history…",
  INCREMENTAL: "Checking for new mail…",
  QUOTA_PAUSED: "Paused (Gmail quota)",
};

export function phaseLabel(phase?: string, status?: string): string {
  if (phase && PHASE_LABELS[phase]) return PHASE_LABELS[phase];
  if (status === "FAILED") return "Sync failed";
  if (status === "RUNNING") return "Syncing…";
  if (status === "QUOTA_PAUSED") return "Paused (Gmail quota)";
  return "Idle";
}
