import { closeQueues } from "@/lib/jobs/queues";
import { startWorkers } from "@/lib/jobs/worker";

const workers = startWorkers();
async function shutdown() {
  await Promise.all(workers.map((worker) => worker.close()));
  await closeQueues();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log("Kotori background workers started");
