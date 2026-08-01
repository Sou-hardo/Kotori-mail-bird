"use client";
import { useState } from "react";

type Option = { id: string; body: string; rank: number };
const tones = [
  "Professional",
  "Warm professional",
  "Friendly",
  "Direct",
  "Diplomatic",
  "Academic",
];
export function ReplyComposer({
  threadId,
  initial,
  identities,
}: {
  threadId: string;
  initial?: { flags: string[]; options: Option[] };
  identities: Array<{
    id: string;
    label: string;
    closing: string;
    isDefault: boolean;
  }>;
}) {
  const [options, setOptions] = useState(initial?.options ?? []);
  const [flags, setFlags] = useState(initial?.flags ?? []);
  const [acks, setAcks] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function generate(form: FormData) {
    setBusy(true);
    setStatus("Creating three distinct options…");
    const res = await fetch("/api/ai/replies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId,
        intent: form.get("intent"),
        tone: form.get("tone"),
        length: form.get("length"),
        identityId: form.get("identityId"),
        acknowledgements: acks,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setFlags(data.flags);
      setStatus("Please review the safety notes first.");
    } else if (res.ok)
      setStatus(
        `Generation queued (${data.jobId}). Refresh shortly to review exactly three options.`,
      );
    else
      setStatus(
        data.error
          ? `Could not generate: ${data.error}`
          : "Could not generate replies. Please try again.",
      );
    setBusy(false);
  }
  async function action(
    id: string,
    action: "approve" | "reject" | "edit",
    body?: string,
  ) {
    setBusy(true);
    const res = await fetch(`/api/ai/replies/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        action === "approve"
          ? { action, acknowledgements: acks }
          : action === "edit"
            ? { action, body }
            : { action, reason: "Not the direction I want" },
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (action === "edit") {
        setFlags(data.requiredReviewFlags ?? []);
        setAcks([]);
      }
      setStatus(
        action === "approve"
          ? "Approved. Your Gmail draft is ready to create—nothing has been sent."
          : action === "reject"
            ? "Option rejected. Regenerate when ready."
            : "Edits saved.",
      );
    } else {
      setFlags(data.flags ?? []);
      setStatus(
        data.error
          ? `Could not update: ${data.error}`
          : "Review acknowledgement required.",
      );
    }
    setBusy(false);
  }
  return (
    <section className="composer">
      <div className="composer-heading">
        <span>✦</span>
        <div>
          <h2>Draft a reply</h2>
          <p>You review every word. Kotori never sends email.</p>
        </div>
      </div>
      <form action={generate}>
        <label>
          What do you want to communicate?
          <textarea
            name="intent"
            required
            placeholder="Confirm I’ll review it by Thursday and ask whether legal has signed off."
          />
        </label>
        <div className="form-grid">
          <label>
            Tone
            <select name="tone">
              {tones.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Length
            <select name="length">
              <option value="short">Short</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label>
            Send as
            <select
              name="identityId"
              required
              defaultValue={identities.find((x) => x.isDefault)?.id}
            >
              {identities.map((identity) => (
                <option value={identity.id} key={identity.id}>
                  {identity.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {flags.length > 0 && (
          <fieldset className="safety">
            <legend>Safety review required</legend>
            {flags.map((f) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={acks.includes(f)}
                  onChange={(e) =>
                    setAcks(
                      e.target.checked
                        ? [...acks, f]
                        : acks.filter((x) => x !== f),
                    )
                  }
                />
                I reviewed: {f.replaceAll("_", " ").toLowerCase()}
              </label>
            ))}
          </fieldset>
        )}
        <button className="primary" disabled={busy}>
          {options.length
            ? "Regenerate three options"
            : "Create three reply options"}
        </button>
      </form>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
      <div className="options">
        {options.map((o, i) => (
          <article key={o.id}>
            <header>
              <strong>Option {i + 1}</strong>
              <span>
                {["Balanced", "Brief & direct", "Warm & collaborative"][i]}
              </span>
            </header>
            <textarea
              aria-label={`Reply option ${i + 1}`}
              defaultValue={o.body}
              onBlur={(e) =>
                setOptions(
                  options.map((x) =>
                    x.id === o.id ? { ...x, body: e.target.value } : x,
                  ),
                )
              }
            />
            <div>
              <button onClick={() => action(o.id, "reject")} disabled={busy}>
                Reject
              </button>
              <button
                onClick={() =>
                  action(o.id, "edit", options.find((x) => x.id === o.id)?.body)
                }
                disabled={busy}
              >
                Save edits
              </button>
              <button
                className="primary"
                onClick={() => action(o.id, "approve")}
                disabled={busy}
              >
                Approve draft
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
