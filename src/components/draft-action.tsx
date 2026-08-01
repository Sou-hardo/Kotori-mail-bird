"use client";
import { useState } from "react";
export function DraftAction({ id }: { id: string }) {
  const [message, setMessage] = useState("");
  return (
    <span>
      <button
        className="primary"
        onClick={async () => {
          setMessage("Creating…");
          const r = await fetch("/api/gmail/drafts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ draftId: id }),
          });
          setMessage(r.ok ? "Queued in Gmail" : "Could not create draft");
        }}
      >
        Create Gmail draft
      </button>
      {message && <small role="status">{message}</small>}
    </span>
  );
}
