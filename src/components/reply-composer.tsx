"use client";
import { useState } from "react";

type Option = { id: string; body: string; rank: number };
const tones = [
  "Warm",
  "Professional",
  "Concise",
  "Friendly",
  "Direct",
  "Empathetic",
];
export function ReplyComposer({
  threadId,
  initial,
}: {
  threadId: string;
  initial?: { flags: string[]; options: Option[] };
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
        tone: String(form.get("tone")).toLowerCase(),
        length: form.get("length"),
        identity: form.get("identity"),
        closing: form.get("closing"),
        acknowledgements: acks,
      }),
    });
    const data = await res.json();
    if (res.status === 409) {
      setFlags(data.flags);
      setStatus("Please review the safety notes first.");
    } else
      setStatus(
        `Generation queued (${data.jobId}). Refresh shortly to review exactly three options.`,
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
    const data = await res.json();
    if (res.ok)
      setStatus(
        action === "approve"
          ? "Approved. Your Gmail draft is ready to create—nothing has been sent."
          : action === "reject"
            ? "Option rejected. Regenerate when ready."
            : "Edits saved.",
      );
    else {
      setFlags(data.flags ?? []);
      setStatus("Review acknowledgement required.");
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
            <select name="identity">
              <option>Primary identity</option>
              <option>Work identity</option>
              <option>Personal identity</option>
            </select>
          </label>
          <label>
            Closing
            <select name="closing">
              <option>Best,</option>
              <option>Thanks,</option>
              <option>Warmly,</option>
              <option>No closing</option>
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
