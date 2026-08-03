import Link from "next/link";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import {
  confidenceLabel,
  initials,
  relativeTime,
  urgencyLabel,
} from "@/lib/ui";
import { Icon } from "@/components/icons";

type ConnectionSyncStatus = {
  status: string;
  // dto() converts epoch milliseconds to ISO strings at the Convex boundary,
  // so this arrives as a string despite being v.number() in the schema.
  syncState: { lastCompletedAt?: string } | null;
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; gmail?: string }>;
}) {
  const { q, filter, gmail } = await searchParams;
  const [threads, connections] = await Promise.all([
    fetchAuthQuery(convexApi.domain.listInbox, { q, filter }),
    fetchAuthQuery(
      convexApi.domain.listConnections,
      {},
    ) as Promise<unknown> as Promise<ConnectionSyncStatus[]>,
  ]);
  const activeConnection = connections.find((c) => c.status === "ACTIVE");
  const firstSyncPending =
    !!activeConnection && !activeConnection.syncState?.lastCompletedAt;
  return (
    <div className="page-wrap">
      {gmail === "connected" ? (
        <p className="banner" role="status">
          Gmail connected. Kotori is syncing your inbox now.
        </p>
      ) : null}
      <header className="page-header">
        <div>
          <p className="eyebrow">Good morning</p>
          <h1>Inbox</h1>
          <p>
            {
              threads.filter(
                (t: any) => t.classification?.category === "ACTION_REQUIRED",
              ).length
            }{" "}
            messages need your attention
          </p>
        </div>
        <span className="status-dot">Up to date</span>
      </header>
      <form className="search" role="search">
        <Icon name="search" />
        <input
          name="q"
          defaultValue={q}
          aria-label="Search inbox"
          placeholder="Search people, subjects, or messages"
        />
      </form>
      <div className="filters" aria-label="Inbox filters">
        <Link className={!filter ? "active" : ""} href="/inbox">
          All
        </Link>
        <Link
          className={filter === "attention" ? "active" : ""}
          href="/inbox?filter=attention"
        >
          Needs attention
        </Link>
        <Link
          className={filter === "unread" ? "active" : ""}
          href="/inbox?filter=unread"
        >
          Unread
        </Link>
      </div>
      <section aria-labelledby="attention-heading">
        <div className="section-title">
          <h2 id="attention-heading">Needs your attention</h2>
          <span>{threads.length}</span>
        </div>
        <div className="thread-list">
          {threads.length ? (
            threads.map((t: any) => {
              const sender = t.messages[0]?.fromAddress ?? "Unknown sender";
              return (
                <article className="thread-card" key={t.id}>
                  <Link href={`/inbox/${t.id}`}>
                    <div className="avatar coral">{initials(sender)}</div>
                    <div className="thread-main">
                      <div className="thread-top">
                        <strong>{sender.split("<")[0]}</strong>
                        <time>{relativeTime(new Date(t.latestMessageAt))}</time>
                      </div>
                      <h3>{t.subject ?? "(No subject)"}</h3>
                      <p>{t.summary?.summary ?? t.snippet}</p>
                      <div className="chips">
                        <span className="urgent">
                          {urgencyLabel(
                            t.classification?.category ?? "UNKNOWN",
                          )}
                        </span>
                        <span>
                          {confidenceLabel(t.classification?.confidence ?? 0)}
                        </span>
                      </div>
                      <div className="action-line">
                        {t.summary?.requestedActions[0] ?? "Open to review"}
                        <b>Review →</b>
                      </div>
                    </div>
                  </Link>
                </article>
              );
            })
          ) : (
            <div className="empty">
              <span>✓</span>
              {firstSyncPending ? (
                <>
                  <h2>First sync in progress</h2>
                  <p>
                    Kotori is importing your mailbox. This can take a few
                    minutes.
                  </p>
                </>
              ) : (
                <>
                  <h2>You’re all caught up</h2>
                  <p>No messages match this view.</p>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
