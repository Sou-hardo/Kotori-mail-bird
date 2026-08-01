import { requireCurrentTenant } from "@/lib/auth/current-tenant";
import { db } from "@/lib/db";
import { ReminderManager } from "@/components/reminder-manager";
export default async function FollowUpsPage() {
  const { userId } = await requireCurrentTenant();
  const items = await db.followUpReminder.findMany({
    where: { userId },
    orderBy: { dueAt: "asc" },
  });
  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Stay on track</p>
          <h1>Follow-ups</h1>
          <p>Bring important conversations back at the right time.</p>
        </div>
      </header>
      <ReminderManager
        initial={items.map((x) => ({ ...x, dueAt: x.dueAt.toISOString() }))}
      />
    </div>
  );
}
