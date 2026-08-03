import { redirect } from "next/navigation";
import { isAuthenticated, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { ConnectPanel } from "@/components/connect-panel";

type ConnectionStatus = { status: string };

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
  return (
    <main id="main-content" className="page-wrap">
      <ConnectPanel error={error} />
    </main>
  );
}
