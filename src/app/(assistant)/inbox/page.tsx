import Link from "next/link";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import {
  confidenceLabel,
  initials,
  relativeTime,
  urgencyLabel,
} from "@/lib/ui";
import { Icon } from "@/components/icons";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { tenantId } = await requireCurrentTenant();
  const { q, filter } = await searchParams;
  const threads = await db.emailThread.findMany({
    where: {
      tenantId,
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { snippet: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filter === "unread" ? { isUnread: true } : {}),
      ...(filter === "attention"
        ? { classification: { category: "ACTION_REQUIRED" } }
        : {}),
    },
    include: {
      classification: true,
      summary: true,
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
    orderBy: { latestMessageAt: "desc" },
  });
  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Good morning</p>
          <h1>Inbox</h1>
          <p>
            {
              threads.filter(
                (t) => t.classification?.category === "ACTION_REQUIRED",
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
            threads.map((t) => {
              const sender = t.messages[0]?.fromAddress ?? "Unknown sender";
              return (
                <article className="thread-card" key={t.id}>
                  <Link href={`/inbox/${t.id}`}>
                    <div className="avatar coral">{initials(sender)}</div>
                    <div className="thread-main">
                      <div className="thread-top">
                        <strong>{sender.split("<")[0]}</strong>
                        <time>{relativeTime(t.latestMessageAt)}</time>
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
              <h2>You’re all caught up</h2>
              <p>No messages match this view.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
