import { fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { IdentityManager } from "@/components/identity-manager";
import { MailboxCard, type MailboxConnection } from "@/components/mailbox-card";
import { ReplyPreferenceControl } from "./reply-preference";
export default async function SettingsPage() {
  const [identities, replyPreference, connections] = await Promise.all([
    fetchAuthQuery(convexApi.domain.listIdentities, {}),
    fetchAuthQuery(convexApi.domain.getReplyPreference, {}),
    fetchAuthQuery(convexApi.domain.listConnections, {}),
  ]);
  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Make it sound like you</p>
          <h1>Settings</h1>
          <p>
            Manage the identities, signatures, and closings used in reply
            options.
          </p>
        </div>
      </header>
      <MailboxCard
        connection={(connections[0] as MailboxConnection | undefined) ?? null}
      />
      <ReplyPreferenceControl
        initialGenerateThreeSuggestions={
          replyPreference.generateThreeSuggestions
        }
      />
      <IdentityManager initial={identities} />
      <section className="settings-note">
        <h2>Privacy & control</h2>
        <p>
          Kotori only creates Gmail drafts after explicit approval. It never
          sends email, and every AI suggestion remains editable.
        </p>
      </section>
    </div>
  );
}
