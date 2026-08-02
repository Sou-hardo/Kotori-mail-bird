import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval(
  "poll active Gmail connections",
  { minutes: 5 },
  internal.jobs.pollActiveConnections,
  {},
);
crons.cron("privacy retention", "17 3 * * *", internal.jobs.retentionBatch, {});
export default crons;
