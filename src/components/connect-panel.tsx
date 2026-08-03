type ConnectErrorCode = "state" | "consent" | "identity" | "unknown";

const ERROR_MESSAGES: Record<ConnectErrorCode, string> = {
  state:
    "Your connection request expired or could not be verified. Please try again.",
  consent:
    "Google consent did not include both Gmail permissions and offline access. Please try again and approve all requested permissions.",
  identity:
    "Google did not return a verifiable account identity. Please try again.",
  unknown: "Something went wrong connecting your mailbox. Please try again.",
};

export function errorMessage(code?: string): string | undefined {
  if (!code) return undefined;
  if (code === "state" || code === "consent" || code === "identity")
    return ERROR_MESSAGES[code];
  return ERROR_MESSAGES.unknown;
}

export function ConnectPanel({ error }: { error?: string }) {
  const message = errorMessage(error);
  return (
    <section className="panel">
      <p className="eyebrow">Kotori Mail Bird</p>
      <h1>Connect Gmail</h1>
      <p>
        Kotori reads your inbox with the <code>gmail.readonly</code> scope to
        summarize and classify messages. With the <code>gmail.compose</code>{" "}
        scope, it can create Gmail drafts — but only after you explicitly review
        and approve each one. Kotori has no send permission: it never sends
        email on your behalf.
      </p>
      {message ? <p role="alert">{message}</p> : null}
      <a href="/api/gmail/connect">Connect Gmail</a>
    </section>
  );
}
