import { notFound } from "next/navigation";
import { ConnectPanel } from "@/components/connect-panel";

export default async function ConnectSmokePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (process.env.PLAYWRIGHT_TEST_MODE !== "1") notFound();
  const { error } = await searchParams;
  return (
    <main id="main-content" className="page-wrap">
      <ConnectPanel error={error} />
    </main>
  );
}
