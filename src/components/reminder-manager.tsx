"use client";
import { useState } from "react";
type Item = {
  id: string;
  title: string;
  note: string | null;
  dueAt: string;
  status: string;
};
export function ReminderManager({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  async function reload() {
    const r = await fetch("/api/follow-ups");
    setItems(await r.json());
  }
  async function create(fd: FormData) {
    await fetch("/api/follow-ups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: fd.get("title"),
        note: fd.get("note"),
        dueAt: fd.get("dueAt"),
      }),
    });
    reload();
  }
  return (
    <>
      <form action={create} className="inline-form">
        <label>
          Reminder
          <input name="title" required placeholder="Follow up with Alex" />
        </label>
        <label>
          When
          <input name="dueAt" type="datetime-local" required />
        </label>
        <label>
          Note
          <input name="note" placeholder="Optional context" />
        </label>
        <button className="primary">Add reminder</button>
      </form>
      <div className="thread-list">
        {items.length ? (
          items.map((x) => (
            <article className="list-card" key={x.id}>
              <div>
                <span className="badge">{x.status}</span>
                <h2>{x.title}</h2>
                <p>
                  {new Date(x.dueAt).toLocaleString()} {x.note && `· ${x.note}`}
                </p>
              </div>
              <div>
                {x.status !== "DONE" && (
                  <button
                    onClick={async () => {
                      await fetch(`/api/follow-ups/${x.id}`, {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ status: "DONE" }),
                      });
                      reload();
                    }}
                  >
                    Mark done
                  </button>
                )}
                <button
                  className="danger"
                  onClick={async () => {
                    await fetch(`/api/follow-ups/${x.id}`, {
                      method: "DELETE",
                    });
                    reload();
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="empty">
            <span>◷</span>
            <h2>Nothing to chase</h2>
            <p>Add a reminder when a conversation needs another look.</p>
          </div>
        )}
      </div>
    </>
  );
}
