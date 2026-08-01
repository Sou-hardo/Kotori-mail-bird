import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { IdentityManager } from "@/components/identity-manager";
export default async function SettingsPage() {
  const { userId } = await requireCurrentTenant();
  const identities = await db.identityProfile.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { label: "asc" }],
  });
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
