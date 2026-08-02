import { fetchAuthQuery } from "@/lib/auth-server";
import { convexApi } from "@/lib/convex-api";
import { ReminderManager } from "@/components/reminder-manager";
export default async function FollowUpsPage() {
  const items = await fetchAuthQuery(convexApi.domain.listReminders, {});
  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Stay on track</p>
          <h1>Follow-ups</h1>
          <p>Bring important conversations back at the right time.</p>
        </div>
      </header>
      <ReminderManager initial={items} />
    </div>
  );
}
