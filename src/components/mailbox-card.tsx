"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SyncState = {
  status: "IDLE" | "RUNNING" | "FAILED" | string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastError?: string;
  updatedAt: string;
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

function formatTimestamp(value?: string) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString();
}

const terminalFailureStatuses = ["FAILED", "DEAD_LETTER", "CANCELLED"];

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

export function MailboxCard({
  connection,
}: {
  connection: MailboxConnection | null;
}) {
  const router = useRouter();
  const [syncState, setSyncState] = useState(connection?.syncState ?? null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const pollSequence = useRef(0);

  useEffect(
    () => () => {
      pollSequence.current += 1;
    },
    [],
  );

  async function pollSync(
    connectionId: string,
    jobId: string,
    sequence: number,
  ) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      if (pollSequence.current !== sequence) return;
      const response = await fetch(
        `/api/gmail/sync?connectionId=${encodeURIComponent(connectionId)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error ?? "sync_status_unavailable");
      if (data.sync) setSyncState(data.sync);
      const jobs: Job[] = Array.isArray(data.jobs) ? data.jobs : [];
      const outcome = resolveSyncJobOutcome(jobs, jobId);
      if (outcome.kind === "succeeded") {
        setStatus("Mailbox refresh finished.");
        return;
      }
      if (outcome.kind === "failed") {
        throw new Error(`Mailbox refresh ${outcome.status.toLowerCase()}.`);
      }
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
      <p>
        {syncState
          ? `Last refresh: ${syncState.status.toLowerCase()} (${formatTimestamp(
              syncState.lastCompletedAt ?? syncState.lastStartedAt,
            )})`
          : "This mailbox has not been refreshed yet."}
      </p>
      {revoked ? (
        <a className="primary" href="/api/gmail/connect">
          Reconnect Gmail
        </a>
      ) : (
        <div className="mailbox-actions">
          <button
            type="button"
            aria-label="Sync mailbox now"
            disabled={busy}
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
