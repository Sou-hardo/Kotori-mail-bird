import { notFound } from "next/navigation";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { ReplyComposer } from "@/components/reply-composer";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const thread = await fetchAuthQuery(convexApi.domain.getThread, { id });
  if (!thread) notFound();
  const identities = thread.identities;
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
          {new Date(thread.latestMessageAt).toLocaleDateString()}
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
        {thread.messages.map((m: any) => (
          <article key={m.id}>
            <div>
              <strong>{m.fromAddress}</strong>
              <time>{new Date(m.sentAt).toLocaleString()}</time>
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
