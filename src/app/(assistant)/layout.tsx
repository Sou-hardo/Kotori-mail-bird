import { isAuthenticated, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";

type ConnectionStatus = { status: string };

export default async function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthenticated())) redirect("/sign-in");
  const [principal, connections] = await Promise.all([
    fetchAuthQuery(convexApi.domain.currentPrincipal, {}),
    fetchAuthQuery(
      convexApi.domain.listConnections,
      {},
    ) as Promise<unknown> as Promise<ConnectionStatus[]>,
  ]);
  if (!connections.some((c) => c.status === "ACTIVE")) redirect("/connect");
  return <AppShell user={principal.user}>{children}</AppShell>;
}
