"use client";

import { useState } from "react";

export function ReplyPreferenceControl({
  initialGenerateThreeSuggestions,
}: {
  initialGenerateThreeSuggestions: boolean;
}) {
  const [enabled, setEnabled] = useState(initialGenerateThreeSuggestions);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function update(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/preferences/replies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generateThreeSuggestions: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error ?? "preference_update_failed");
      setEnabled(data.generateThreeSuggestions);
      setStatus("Reply suggestion preference saved.");
    } catch {
      setEnabled(previous);
      setStatus("Could not save the preference. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-note" aria-labelledby="reply-mode-heading">
      <h2 id="reply-mode-heading">Reply suggestions</h2>
      <label>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={saving}
          onChange={(event) => update(event.target.checked)}
        />{" "}
        <strong>Generate three suggestions</strong>
      </label>
      <p>
        {enabled
          ? "Kotori will create three distinct, editable options for each request."
          : "Kotori will create one compact, editable suggestion for each request."}
      </p>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
