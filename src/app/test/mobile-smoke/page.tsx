import { notFound } from "next/navigation";
import { ReplyComposer } from "@/components/reply-composer";
import { ReplyPreferenceControl } from "@/app/(assistant)/settings/reply-preference";

export default async function MobileSmokePage({
  searchParams,
}: {
  searchParams: Promise<{ three?: string }>;
}) {
  if (process.env.PLAYWRIGHT_TEST_MODE !== "1") notFound();
  const generateThreeSuggestions = (await searchParams).three === "1";
  return (
    <main id="main-content" className="page-wrap detail">
      <header className="detail-header">
        <p className="eyebrow">Action required</p>
        <h1>Review the launch checklist</h1>
        <p>Production-like authenticated composer fixture for browser tests.</p>
      </header>
      <ReplyComposer
        threadId="cm0000000000000000000001"
        generateThreeSuggestions={generateThreeSuggestions}
        identities={[
          {
            id: "cm0000000000000000000002",
            label: "Work",
            closing: "Best,",
            isDefault: true,
          },
        ]}
        initial={{
          flags: [],
          options: [
            {
              id: "cm0000000000000000000003",
              rank: 1,
              body: "Thanks — I’ll review it.",
            },
          ],
        }}
      />
      <ReplyPreferenceControl
        initialGenerateThreeSuggestions={generateThreeSuggestions}
      />
    </main>
  );
}
