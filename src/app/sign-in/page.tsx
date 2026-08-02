"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function signIn() {
    setPending(true);
    setError(undefined);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/inbox",
    });
    if (result.error) {
      setError(result.error.message ?? "Unable to sign in.");
      setPending(false);
    }
  }
  return (
    <main id="main-content" className="page-wrap">
      <section className="panel">
        <p className="eyebrow">Kotori Mail Bird</p>
        <h1>Sign in</h1>
        <p>Continue with Google to open your private workspace.</p>
        <button type="button" disabled={pending} onClick={signIn}>
          {pending ? "Connecting…" : "Continue with Google"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
