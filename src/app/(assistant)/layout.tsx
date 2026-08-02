import { isAuthenticated, fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";

export default async function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAuthenticated()))
    redirect("/api/auth/sign-in/social?provider=google");
  const principal = await fetchAuthQuery(convexApi.domain.currentPrincipal, {});
  return <AppShell user={principal.user}>{children}</AppShell>;
}
