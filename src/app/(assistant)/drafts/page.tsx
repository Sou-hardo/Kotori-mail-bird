import Link from "next/link";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { DraftAction } from "@/components/draft-action";
export default async function DraftsPage() {
  const drafts = await fetchAuthQuery(convexApi.domain.listDrafts, {});
  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Review-first workflow</p>
          <h1>Drafts</h1>
          <p>Approved replies waiting in Kotori or created in Gmail.</p>
        </div>
      </header>
      <div className="thread-list">
        {drafts.length ? (
          drafts.map((d: any) => (
            <article className="list-card" key={d.id}>
              <div>
                <span className="badge">{d.status.replaceAll("_", " ")}</span>
                <h2>{d.subject ?? d.thread.subject}</h2>
                <p>{d.body.slice(0, 180)}</p>
              </div>
              <div>
                <Link href={`/inbox/${d.threadId}`}>Review thread</Link>
                {d.status === "APPROVED" && <DraftAction id={d.id} />}
              </div>
            </article>
          ))
        ) : (
          <div className="empty">
            <span>✎</span>
            <h2>No drafts yet</h2>
            <p>Approve a reply option and it will appear here.</p>
            <Link className="primary" href="/inbox">
              Review inbox
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
