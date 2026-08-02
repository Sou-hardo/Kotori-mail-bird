import { fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { PushControl } from "@/components/push-control";
export default async function NotificationsPage() {
  const notes = await fetchAuthQuery(convexApi.domain.listNotifications, {});
  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">What changed</p>
          <h1>Notifications</h1>
          <p>Drafts, reminders, and conversations requiring attention.</p>
        </div>
        <PushControl
          publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        />
      </header>
      <div className="thread-list">
        {notes.length ? (
          notes.map((n) => (
            <article
              className={`notification ${n.readAt ? "read" : ""}`}
              key={n.id}
            >
              <span>●</span>
              <div>
                <small>{n.kind.replaceAll("_", " ")}</small>
                <h2>{n.title}</h2>
                <p>{n.body}</p>
                <time>{new Date(n.createdAt).toLocaleString()}</time>
              </div>
            </article>
          ))
        ) : (
          <div className="empty">
            <span>♢</span>
            <h2>Quiet for now</h2>
            <p>New activity will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
