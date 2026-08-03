import { phaseLabel, progressPercent, remaining } from "@/lib/sync-progress";

export type SyncProgressProps = {
  phase?: string;
  status?: string;
  totalThreads?: number;
  importedThreads?: number;
  totalMessages?: number;
  importedMessages?: number;
  resumeAt?: number;
  quota?: { dayUnits: number; dayBudget: number; dayPercent: number } | null;
  compact?: boolean;
};

export function SyncProgress({
  phase,
  status,
  totalThreads,
  importedThreads,
  totalMessages,
  importedMessages,
  resumeAt,
  quota,
  compact = false,
}: SyncProgressProps) {
  const usingMessages =
    totalThreads === undefined && totalMessages !== undefined;
  const imported = usingMessages ? importedMessages : importedThreads;
  const total = usingMessages ? totalMessages : totalThreads;
  const unit = usingMessages ? "messages" : "threads";
  const percent = progressPercent(imported, total);
  const left = remaining(imported, total);
  const label = phaseLabel(phase, status);
  const roundedPercent = percent === null ? undefined : Math.round(percent);
  const importedLabel =
    typeof imported === "number"
      ? total !== undefined && total !== null
        ? `${imported} of ${total} ${unit}`
        : `${imported} ${unit} imported`
      : "Preparing…";
  const remainingLabel = left !== null ? ` · ${left} remaining` : "";

  return (
    <div
      className={`sync-progress${compact ? "sync-progress-compact" : ""}`}
      role="status"
    >
      <p className="sync-progress-phase">{label}</p>
      <progress
        className="sync-progress-bar"
        aria-label="Mailbox import progress"
        aria-valuenow={roundedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        value={roundedPercent}
        max={100}
      />
      <p className="sync-progress-count">
        {importedLabel}
        {remainingLabel}
      </p>
      {!compact && quota ? (
        <p className="quota-meter">
          {formatQuotaPercent(quota.dayPercent)}% of today&apos;s free Gmail
          quota
        </p>
      ) : null}
      {resumeAt ? (
        <p className="sync-progress-resume">
          Resumes at {new Date(resumeAt).toLocaleTimeString()}
        </p>
      ) : null}
    </div>
  );
}

function formatQuotaPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
