import { redirect } from "next/navigation";
import { isAuthenticated, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";

type ConnectErrorCode = "state" | "consent" | "identity" | "unknown";
type ConnectionStatus = { status: string };

const ERROR_MESSAGES: Record<ConnectErrorCode, string> = {
  state:
    "Your connection request expired or could not be verified. Please try again.",
  consent:
    "Google consent did not include both Gmail permissions and offline access. Please try again and approve all requested permissions.",
  identity:
    "Google did not return a verifiable account identity. Please try again.",
  unknown: "Something went wrong connecting your mailbox. Please try again.",
};

function errorMessage(code?: string): string | undefined {
  if (!code) return undefined;
  if (code === "state" || code === "consent" || code === "identity")
    return ERROR_MESSAGES[code];
  return ERROR_MESSAGES.unknown;
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await isAuthenticated())) redirect("/sign-in");
  const { error } = await searchParams;
  const connections = (await fetchAuthQuery(
    convexApi.domain.listConnections,
    {},
  )) as unknown as ConnectionStatus[];
  if (connections.some((c) => c.status === "ACTIVE")) redirect("/inbox");
  const message = errorMessage(error);
  return (
    <main id="main-content" className="page-wrap">
      <section className="panel">
        <p className="eyebrow">Kotori Mail Bird</p>
        <h1>Connect Gmail</h1>
        <p>
          Kotori reads your inbox with the <code>gmail.readonly</code> scope to
          summarize and classify messages. With the <code>gmail.compose</code>{" "}
          scope, it can create Gmail drafts — but only after you explicitly
          review and approve each one. Kotori has no send permission: it never
          sends email on your behalf.
        </p>
        {message ? <p role="alert">{message}</p> : null}
        <a href="/api/gmail/connect">Connect Gmail</a>
      </section>
    </main>
  );
}
