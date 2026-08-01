import { db } from "@/lib/db";
import { runRetentionCleanup } from "@/lib/retention";

try {
  const deleted = await runRetentionCleanup();
  console.log("Retention cleanup complete", deleted);
} finally {
  await db.$disconnect();
}
