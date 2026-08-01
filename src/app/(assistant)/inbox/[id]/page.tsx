import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { ReplyComposer } from "@/components/reply-composer";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId, userId } = await requireCurrentTenant();
  const { id } = await params;
  const thread = await db.emailThread.findFirst({
    where: { id, tenantId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      summary: true,
      classification: true,
      replyGenerations: {
        include: { options: { orderBy: { rank: "asc" } } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!thread) notFound();
  const identities = await db.identityProfile.findMany({
    where: { userId },
    select: { id: true, label: true, closing: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { label: "asc" }],
  });
  return (
    <div className="page-wrap detail">
      <Link className="back" href="/inbox">
        ← Inbox
      </Link>
      <header className="detail-header">
        <p className="eyebrow">
          {thread.classification?.category.replaceAll("_", " ")}
        </p>
        <h1>{thread.subject}</h1>
        <p>
          {thread.messages.length} message
          {thread.messages.length === 1 ? "" : "s"} · Last activity{" "}
          {thread.latestMessageAt.toLocaleDateString()}
        </p>
      </header>
      <section className="summary-card">
        <div>
          <span>✦</span>
          <h2>Kotori summary</h2>
        </div>
        <p>{thread.summary?.summary ?? thread.snippet}</p>
        <dl>
          <div>
            <dt>Requested action</dt>
            <dd>
              {thread.summary?.requestedActions.join(", ") ||
                "Review and respond"}
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              {Math.round((thread.classification?.confidence ?? 0) * 100)}%
            </dd>
          </div>
        </dl>
      </section>
      <section className="messages" aria-label="Email thread">
        {thread.messages.map((m) => (
          <article key={m.id}>
            <div>
              <strong>{m.fromAddress}</strong>
              <time>{m.sentAt.toLocaleString()}</time>
            </div>
            <p>{m.bodyText ?? m.snippet}</p>
          </article>
        ))}
      </section>
      <ReplyComposer
        threadId={thread.id}
        identities={identities}
        initial={
          thread.replyGenerations[0]
            ? {
                flags: thread.replyGenerations[0].requiredReviewFlags,
                options: thread.replyGenerations[0].options,
              }
            : undefined
        }
      />
    </div>
  );
}
