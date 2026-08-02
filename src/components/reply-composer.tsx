"use client";
import { useEffect, useRef, useState } from "react";

type Option = { id: string; body: string; rank: number; tone?: string };
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
  generateThreeSuggestions,
}: {
  threadId: string;
  initial?: { flags: string[]; options: Option[] };
  identities: Array<{
    id: string;
    label: string;
    closing: string;
    isDefault: boolean;
  }>;
  generateThreeSuggestions: boolean;
}) {
  const [options, setOptions] = useState(initial?.options ?? []);
  const [flags, setFlags] = useState(initial?.flags ?? []);
  const [acks, setAcks] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const generationSequence = useRef(0);

  useEffect(
    () => () => {
      generationSequence.current += 1;
    },
    [],
  );

  async function pollGeneration(jobId: string, sequence: number) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      if (generationSequence.current !== sequence) return;
      const response = await fetch(
        `/api/ai/replies?jobId=${encodeURIComponent(jobId)}&threadId=${encodeURIComponent(threadId)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error ?? "generation_status_unavailable");
      if (data.status === "SUCCEEDED") {
        const completedOptions = Array.isArray(data.options)
          ? data.options
          : [];
        if (!completedOptions.length) throw new Error("generation_empty");
        setOptions(completedOptions);
        setFlags((current) =>
          data.requiredReviewFlags?.length ? data.requiredReviewFlags : current,
        );
        setStatus(
          completedOptions.length === 1
            ? "Your editable suggestion is ready. Review every word before approving it as a Gmail draft."
            : `${completedOptions.length} editable options are ready. Review every word before approving a Gmail draft.`,
        );
        return;
      }
      if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(data.status))
        throw new Error(data.error ?? "generation_failed");
    }
    throw new Error("generation_timed_out");
  }

  async function generate(form: FormData) {
    const sequence = generationSequence.current + 1;
    generationSequence.current = sequence;
    setBusy(true);
    setStatus(
      generateThreeSuggestions
        ? "Creating three distinct options…"
        : "Creating one focused suggestion…",
    );
    try {
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
        setFlags(data.flags ?? []);
        setStatus("Please review the safety notes first.");
      } else if (res.ok) {
        setFlags(data.requiredReviewFlags ?? flags);
        setStatus(
          `Generation queued. Your ${generateThreeSuggestions ? "suggestions" : "suggestion"} will appear here automatically.`,
        );
        await pollGeneration(data.jobId, sequence);
      } else {
        throw new Error(data.error ?? "generation_failed");
      }
    } catch (error) {
      if (generationSequence.current !== sequence) return;
      setStatus(
        `Could not generate: ${error instanceof Error ? error.message : "generation_failed"}`,
      );
    } finally {
      if (generationSequence.current === sequence) setBusy(false);
    }
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
        <button className="primary" disabled={busy} type="submit">
          {options.length ? "Regenerate" : "Create"}{" "}
          {generateThreeSuggestions ? "three reply options" : "suggestion"}
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
                {o.tone ??
                  ["Balanced", "Brief & direct", "Warm & collaborative"][i] ??
                  "Editable"}
              </span>
            </header>
            <textarea
              aria-label={`Reply option ${i + 1}`}
              value={o.body}
              onChange={(e) =>
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
