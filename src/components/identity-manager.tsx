"use client";
import { useState } from "react";
type Identity = {
  id: string;
  label: string;
  displayName: string;
  email: string;
  role: string | null;
  company: string | null;
  phone: string | null;
  website: string | null;
  pronouns: string | null;
  signature: string;
  closing: string;
  isDefault: boolean;
};
const empty = {
  label: "",
  displayName: "",
  email: "",
  role: "",
  company: "",
  phone: "",
  website: "",
  pronouns: "",
  signature: "",
  closing: "Best,",
  isDefault: false,
};
export function IdentityManager({ initial }: { initial: Identity[] }) {
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Partial<Identity>>(empty);
  const [q, setQ] = useState("");
  async function reload() {
    const r = await fetch("/api/identities");
    setItems(await r.json());
    setEditing(empty);
  }
  async function save(fd: FormData) {
    const body = Object.fromEntries(fd);
    await fetch(
      editing.id ? `/api/identities/${editing.id}` : "/api/identities",
      {
        method: editing.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          isDefault: fd.get("isDefault") === "on",
        }),
      },
    );
    reload();
  }
  const shown = items.filter((x) =>
    `${x.label} ${x.displayName} ${x.email}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <section>
      <div className="section-title">
        <h2>Identity & signature profiles</h2>
        <span>{items.length}</span>
      </div>
      <input
        className="standalone-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search profiles"
        aria-label="Search profiles"
      />
      <div className="identity-grid">
        {shown.map((x) => (
          <article className="identity-card" key={x.id}>
            <div>
              <span className="avatar">{x.displayName[0]}</span>
              <span>
                <h3>
                  {x.label} {x.isDefault && <small>Default</small>}
                </h3>
                <p>
                  {x.displayName} · {x.email}
                </p>
              </span>
            </div>
            <blockquote>{x.signature}</blockquote>
            <div>
              <button onClick={() => setEditing(x)}>Edit</button>
              <button
                className="danger"
                onClick={async () => {
                  await fetch(`/api/identities/${x.id}`, { method: "DELETE" });
                  reload();
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      <form action={save} className="profile-form">
        <h2>{editing.id ? "Edit profile" : "Add profile"}</h2>
        {[
          ["label", "Profile label"],
          ["displayName", "Display name"],
          ["email", "Email"],
          ["role", "Role / title"],
          ["company", "Company"],
          ["phone", "Phone"],
          ["website", "Website"],
          ["pronouns", "Pronouns"],
          ["closing", "Default closing"],
        ].map(([name = "", label]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              type={name === "email" ? "email" : "text"}
              required={["label", "displayName", "email", "closing"].includes(
                name,
              )}
              defaultValue={String(editing[name as keyof Identity] ?? "")}
            />
          </label>
        ))}
        <label className="wide">
          Signature
          <textarea
            name="signature"
            required
            defaultValue={editing.signature ?? ""}
          />
        </label>
        <label className="check">
          <input
            name="isDefault"
            type="checkbox"
            defaultChecked={editing.isDefault}
          />
          Use as default
        </label>
        <button className="primary">Save profile</button>
      </form>
    </section>
  );
}
