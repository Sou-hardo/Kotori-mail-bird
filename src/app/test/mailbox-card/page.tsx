import { notFound } from "next/navigation";
import { MailboxCard, type MailboxConnection } from "@/components/mailbox-card";

const CONNECTED: MailboxConnection = {
  id: "cm0000000000000000000010",
  emailAddress: "reader@kotori.test",
  status: "ACTIVE",
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  syncState: null,
};

const REVOKED: MailboxConnection = {
  ...CONNECTED,
  id: "cm0000000000000000000011",
  status: "REVOKED",
};

const IN_PROGRESS: MailboxConnection = {
  ...CONNECTED,
  id: "cm0000000000000000000012",
  syncState: {
    status: "RUNNING",
    phase: "BACKFILL",
    totalThreads: 200,
    importedThreads: 50,
  },
};

const QUOTA_PAUSED: MailboxConnection = {
  ...CONNECTED,
  id: "cm0000000000000000000013",
  syncState: {
    status: "QUOTA_PAUSED",
    phase: "QUOTA_PAUSED",
    totalThreads: 200,
    importedThreads: 50,
    resumeAt: Date.parse("2026-07-02T09:00:00.000Z"),
  },
};

function fixtureFor(variant?: string): MailboxConnection | null {
  switch (variant) {
    case "none":
      return null;
    case "revoked":
      return REVOKED;
    case "in-progress":
      return IN_PROGRESS;
    case "quota-paused":
      return QUOTA_PAUSED;
    default:
      return CONNECTED;
  }
}

export default async function MailboxCardSmokePage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (process.env.PLAYWRIGHT_TEST_MODE !== "1") notFound();
  const { variant } = await searchParams;
  const connection = fixtureFor(variant);
  return (
    <main id="main-content" className="page-wrap detail">
      <header className="detail-header">
        <p className="eyebrow">Settings</p>
        <h1>Mailbox fixture</h1>
        <p>Authenticated mailbox card fixture for browser tests.</p>
      </header>
      <MailboxCard connection={connection} />
    </main>
  );
}
