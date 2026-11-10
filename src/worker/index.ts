import "@/server/load-env";

import { prisma } from "@/lib/prisma";
import { pgPool } from "@/server/db/pg";
import { log } from "@/server/logger";
import { createBoss, ensureQueues, QUEUES, scheduleCleanupStaleUploads, setQueueBoss } from "@/server/queue";
import { errorMessage } from "@/server/services/support";
import { activeHandlers, registerWorkers } from "@/worker/handlers";

/**
 * Queue worker (`npm run worker`): works the upload, upload-failed, default and cleanup queues
 * and schedules `geodata:cleanup-stale` every 30 minutes. On SIGINT / SIGTERM it stops taking
 * jobs, gives running ones WORKER_SHUTDOWN_TIMEOUT_MS to finish (a job still running then is
 * aborted and retried later), and exits.
 */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS ?? 30_000);
/** Time aborted handlers get to kill their containers and record the failure. */
const ABORT_GRACE_MS = 20_000;

async function main(): Promise<void> {
  const boss = await createBoss("worker");
  await boss.start({ attempts: 5 });
  await ensureQueues(boss, { sync: true });
  setQueueBoss(boss);
  await registerWorkers(boss);
  await scheduleCleanupStaleUploads(boss);

  log.info(`Queue worker started (queues: ${Object.values(QUEUES).join(", ")}).`);

  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log.info(`Received ${signal}; stopping the queue worker...`);
    try {
      await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
    } catch (error) {
      log.error(`Queue worker did not stop cleanly: ${errorMessage(error)}`);
    }
    if (activeHandlers.size > 0) {
      await Promise.race([
        Promise.allSettled([...activeHandlers]),
        new Promise((resolve) => setTimeout(resolve, ABORT_GRACE_MS)),
      ]);
    }
    await prisma.$disconnect().catch(() => undefined);
    await pgPool.end().catch(() => undefined);
    log.info("Queue worker stopped.");
    process.exit(0);
  };

  process.on("SIGINT", (signal) => void shutdown(signal));
  process.on("SIGTERM", (signal) => void shutdown(signal));
}

main().catch(async (error: unknown) => {
  log.error(`Queue worker failed to start: ${errorMessage(error)}`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
