"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SyncProgress } from "@/components/sync-progress";

type SyncPhase =
  "IDLE" | "COUNTING" | "BACKFILL" | "INCREMENTAL" | "QUOTA_PAUSED";

type SyncState = {
  status: "IDLE" | "RUNNING" | "FAILED" | "QUOTA_PAUSED" | string;
  phase?: SyncPhase | string;
  totalThreads?: number;
  totalMessages?: number;
  importedThreads?: number;
  importedMessages?: number;
  backfillDone?: boolean;
  resumeAt?: number;
  lastStartedAt?: string | number;
  lastCompletedAt?: string | number;
  lastError?: string;
} | null;

type Quota = {
  dayUnits: number;
  dayBudget: number;
  dayPercent: number;
  minuteUnits: number;
  minuteBudget: number;
} | null;

export type MailboxConnection = {
  id: string;
  emailAddress: string;
  status: "ACTIVE" | "REVOKED" | string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  syncState: SyncState;
};

type Job = { id: string; status: string };

function formatTimestamp(value?: string | number) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString();
}

const terminalFailureStatuses = ["FAILED", "DEAD_LETTER", "CANCELLED"];
const activePhases = ["COUNTING", "BACKFILL", "INCREMENTAL"];
const MAX_POLL_MS = 30 * 60 * 1_000;
const POLL_INTERVAL_MS = 2_000;

export type SyncJobOutcome =
  | { kind: "pending" }
  | { kind: "succeeded" }
  | { kind: "failed"; status: string };

export function resolveSyncJobOutcome(
  jobs: Job[],
  jobId: string,
): SyncJobOutcome {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { kind: "pending" };
  if (job.status === "SUCCEEDED") return { kind: "succeeded" };
  if (terminalFailureStatuses.includes(job.status))
    return { kind: "failed", status: job.status };
  return { kind: "pending" };
}

export function shouldKeepPolling(syncState: SyncState) {
  if (!syncState) return false;
  if (syncState.phase && activePhases.includes(syncState.phase)) return true;
  return syncState.status === "RUNNING";
}

export function MailboxCard({
  connection,
}: {
  connection: MailboxConnection | null;
}) {
  const router = useRouter();
  const [syncState, setSyncState] = useState(connection?.syncState ?? null);
  const [quota, setQuota] = useState<Quota>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const pollSequence = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      pollSequence.current += 1;
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function fetchStatus(connectionId: string, sequence: number) {
    const response = await fetch(
      `/api/gmail/sync?connectionId=${encodeURIComponent(connectionId)}`,
      { cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "sync_status_unavailable");
    if (pollSequence.current !== sequence) return null;
    if (data.syncState !== undefined) setSyncState(data.syncState);
    if (data.quota !== undefined) setQuota(data.quota);
    return data;
  }

  useEffect(() => {
    if (!connection) return;
    const sequence = pollSequence.current;
    fetchStatus(connection.id, sequence).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection?.id]);

  async function pollSync(
    connectionId: string,
    jobId: string,
    sequence: number,
  ) {
    const deadline = Date.now() + MAX_POLL_MS;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = undefined;
          resolve();
        }, POLL_INTERVAL_MS);
      });
      if (pollSequence.current !== sequence) return;
      const data = await fetchStatus(connectionId, sequence);
      if (data === null) return;
      const jobs: Job[] = Array.isArray(data.jobs) ? data.jobs : [];
      const outcome = resolveSyncJobOutcome(jobs, jobId);
      if (outcome.kind === "succeeded") {
        setStatus("Mailbox refresh finished.");
        return;
      }
      if (outcome.kind === "failed") {
        throw new Error(`Mailbox refresh ${outcome.status.toLowerCase()}.`);
      }
      if (!shouldKeepPolling(data.syncState ?? null)) return;
    }
    throw new Error("Mailbox refresh timed out.");
  }

  async function syncNow() {
    if (!connection || busy) return;
    const sequence = pollSequence.current + 1;
    pollSequence.current = sequence;
    setBusy(true);
    setError("");
    setStatus("Starting mailbox refresh…");
    try {
      const response = await fetch("/api/gmail/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id, full: false }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "sync_start_failed");
      if (!data.jobId) throw new Error("sync_start_failed");
      setStatus("Refreshing mailbox…");
      await pollSync(connection.id, data.jobId, sequence);
    } catch (err) {
      if (pollSequence.current !== sequence) return;
      setError(
        err instanceof Error ? err.message : "Could not refresh the mailbox.",
      );
      setStatus("");
    } finally {
      if (pollSequence.current === sequence) setBusy(false);
    }
  }

  async function disconnect() {
    if (!connection || busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/gmail/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connection.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "disconnect_failed");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not disconnect the mailbox.",
      );
      setBusy(false);
    }
  }

  if (!connection) {
    return (
      <section
        className="settings-note mailbox-card"
        aria-labelledby="mailbox-heading"
      >
        <h2 id="mailbox-heading">Mailbox</h2>
        <p>No Gmail mailbox is connected yet.</p>
        <a className="primary" href="/api/gmail/connect">
          Connect Gmail
        </a>
      </section>
    );
  }

  const revoked = connection.status === "REVOKED";
  const quotaPaused = syncState?.status === "QUOTA_PAUSED";

  return (
    <section
      className="settings-note mailbox-card"
      aria-labelledby="mailbox-heading"
    >
      <h2 id="mailbox-heading">Mailbox</h2>
      <p>
        <strong>{connection.emailAddress}</strong> ·{" "}
        {revoked ? "Disconnected" : "Connected"}
      </p>
      {syncState ? (
        <SyncProgress
          phase={syncState.phase}
          status={syncState.status}
          totalThreads={syncState.totalThreads}
          importedThreads={syncState.importedThreads}
          totalMessages={syncState.totalMessages}
          importedMessages={syncState.importedMessages}
          resumeAt={quotaPaused ? syncState.resumeAt : undefined}
          quota={quota}
        />
      ) : (
        <p>This mailbox has not been refreshed yet.</p>
      )}
      {quotaPaused && (
        <p className="notice" role="status">
          Paused to stay within Gmail&apos;s free tier — resumes at{" "}
          {formatTimestamp(syncState?.resumeAt)}
        </p>
      )}
      {!quotaPaused && syncState?.lastCompletedAt && (
        <p>
          Last refresh: {syncState.status.toLowerCase()} (
          {formatTimestamp(
            syncState.lastCompletedAt ?? syncState.lastStartedAt,
          )}
          )
        </p>
      )}
      {revoked ? (
        <a className="primary" href="/api/gmail/connect">
          Reconnect Gmail
        </a>
      ) : (
        <div className="mailbox-actions">
          <button
            type="button"
            aria-label="Sync mailbox now"
            disabled={busy || quotaPaused}
            onClick={syncNow}
          >
            Sync now
          </button>
          <button
            type="button"
            className="danger"
            aria-label="Disconnect mailbox"
            disabled={busy}
            onClick={disconnect}
          >
            Disconnect
          </button>
        </div>
      )}
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
