import type { PgBoss, Queue, SendOptions } from "pg-boss";

import { env } from "@/env";
import type { AssembleGeodataUploadPayload, CleanupLayerFilesPayload, CleanupStaleUploadsPayload } from "@/server/jobs/types";
import { log } from "@/server/logger";
import { errorMessage } from "@/server/services/support";

/**
 * pg-boss queues (Laravel's database queue), stored in the `pgboss` schema of the app database.
 *
 * - upload                 AssembleGeodataUpload: assembly + conversion in one reservation
 * - upload-failed          dead letter queue of `upload`: runs AssembleGeodataUpload::failed()
 *                          once the last attempt failed, timed out or its worker died
 * - default                CleanupLayerFilesJob
 * - geodata-cleanup-stale  scheduled `geodata:cleanup-stale` (every 30 minutes, no overlap)
 *
 * Laravel ran `queue:work --tries=2 --timeout=7200`: every job gets one retry and two hours.
 * pg-boss is imported lazily so that loading a route module never depends on the queue package.
 */
export const QUEUES = {
  upload: "upload",
  uploadFailed: "upload-failed",
  default: "default",
  cleanupStale: "geodata-cleanup-stale",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOB_TRIES = 2;
export const JOB_TIMEOUT_SECONDS = 7200;
export const CLEANUP_STALE_CRON = "*/30 * * * *";
/** WithoutOverlapping::releaseAfter(60) */
export const OVERLAP_RELEASE_SECONDS = 60;

type QueueDefinition = { name: QueueName; options: Omit<Queue, "name"> };

/** Order matters: a dead letter queue must exist before the queue that names it. */
export const QUEUE_DEFINITIONS: QueueDefinition[] = [
  { name: QUEUES.uploadFailed, options: { retryLimit: 2, retryDelay: 30, expireInSeconds: 600 } },
  {
    name: QUEUES.upload,
    // One active job per singletonKey (the conversion job id): no overlap per conversion.
    options: {
      policy: "singleton",
      retryLimit: JOB_TRIES - 1,
      retryDelay: 0,
      expireInSeconds: JOB_TIMEOUT_SECONDS,
      deadLetter: QUEUES.uploadFailed,
    },
  },
  { name: QUEUES.default, options: { retryLimit: JOB_TRIES - 1, retryDelay: 0, expireInSeconds: JOB_TIMEOUT_SECONDS } },
  // At most one queued or running cleanup (Laravel: withoutOverlapping()).
  { name: QUEUES.cleanupStale, options: { policy: "exclusive", retryLimit: 0, expireInSeconds: 1800 } },
];

const UPLOAD_JOB_OPTIONS: SendOptions = {
  retryLimit: JOB_TRIES - 1,
  retryDelay: 0,
  expireInSeconds: JOB_TIMEOUT_SECONDS,
  deadLetter: QUEUES.uploadFailed,
};

const DEFAULT_JOB_OPTIONS: SendOptions = {
  retryLimit: JOB_TRIES - 1,
  retryDelay: 0,
  expireInSeconds: JOB_TIMEOUT_SECONDS,
};

export type BossRole = "web" | "worker";

/** A new, not yet started pg-boss instance. The web process only sends; the worker also supervises and schedules. */
export async function createBoss(role: BossRole): Promise<PgBoss> {
  const { PgBoss } = await import("pg-boss");
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    instanceName: `geodata-${role}`,
    max: role === "worker" ? 6 : 2,
    supervise: role === "worker",
    schedule: role === "worker",
  });
  boss.on("error", (error) => log.error(`pg-boss (${role}) error: ${errorMessage(error)}`));
  boss.on("warning", (warning) => log.warning(`pg-boss (${role}) warning: ${warning.message}`));
  return boss;
}

/** Creates the queues (no-op when they exist); `sync` also re-applies the retry/expiry settings. */
export async function ensureQueues(boss: PgBoss, { sync = false }: { sync?: boolean } = {}): Promise<void> {
  for (const { name, options } of QUEUE_DEFINITIONS) {
    await boss.createQueue(name, options);
    if (sync) {
      const { retryLimit = 2, retryDelay = 0, expireInSeconds = 900, deadLetter = null } = options;
      await boss.updateQueue(name, { retryLimit, retryDelay, expireInSeconds, deadLetter });
    }
  }
}

const globalForQueue = globalThis as typeof globalThis & { __geodataBoss?: Promise<PgBoss> };

/** Uses an already started instance (the worker's) for every enqueue in this process. */
export function setQueueBoss(boss: PgBoss): void {
  globalForQueue.__geodataBoss = Promise.resolve(boss);
}

/** The process-wide producer instance, started on first use. */
export function getBoss(): Promise<PgBoss> {
  if (!globalForQueue.__geodataBoss) {
    globalForQueue.__geodataBoss = (async () => {
      const boss = await createBoss("web");
      await boss.start({ attempts: 2 });
      await ensureQueues(boss);
      return boss;
    })().catch((error: unknown) => {
      globalForQueue.__geodataBoss = undefined;
      throw error;
    });
  }
  return globalForQueue.__geodataBoss;
}

async function send(queue: QueueName, data: object, options: SendOptions): Promise<string> {
  const boss = await getBoss();
  const id = await boss.send(queue, data, options);
  if (!id) throw new Error(`The job could not be added to the "${queue}" queue.`);
  return id;
}

/** Dispatches AssembleGeodataUpload (queue `upload`). Call after the creating transaction committed. */
export function enqueueAssembleGeodataUpload(payload: AssembleGeodataUploadPayload, delaySeconds = 0): Promise<string> {
  return send(QUEUES.upload, payload, {
    ...UPLOAD_JOB_OPTIONS,
    singletonKey: payload.conversionJobId,
    ...(delaySeconds > 0 ? { startAfter: delaySeconds } : {}),
  });
}

/** Dispatches CleanupLayerFilesJob (queue `default`). */
export function enqueueCleanupLayerFiles(payload: CleanupLayerFilesPayload): Promise<string> {
  return send(QUEUES.default, payload, DEFAULT_JOB_OPTIONS);
}

/** Registers the 30-minute stale-upload cleanup (Schedule::command(...)->everyThirtyMinutes()). */
export async function scheduleCleanupStaleUploads(boss: PgBoss, payload: CleanupStaleUploadsPayload = {}): Promise<void> {
  await boss.schedule(QUEUES.cleanupStale, CLEANUP_STALE_CRON, payload, { tz: "UTC", retryLimit: 0, expireInSeconds: 1800 });
}
