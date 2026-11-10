import type { JobWithMetadata, PgBoss } from "pg-boss";

import { failAssembleGeodataUpload, runAssembleGeodataUpload } from "@/server/jobs/assemble-geodata-upload";
import { runCleanupLayerFiles } from "@/server/jobs/cleanup-layer-files-job";
import { withConversionLock } from "@/server/jobs/conversion-lock";
import type {
  AssembleGeodataUploadPayload,
  CleanupLayerFilesPayload,
  CleanupStaleUploadsPayload,
  JobRunContext,
} from "@/server/jobs/types";
import { log } from "@/server/logger";
import { enqueueAssembleGeodataUpload, JOB_TIMEOUT_SECONDS, OVERLAP_RELEASE_SECONDS, QUEUES } from "@/server/queue";
import { errorMessage } from "@/server/services/support";
import { cleanupStaleUploads } from "@/server/services/upload/cleanup-stale-uploads";

/** Handlers still running, so shutdown can wait for their failure handling. */
export const activeHandlers = new Set<Promise<unknown>>();

/** WithoutOverlapping::expireAfter(7400): stop releasing a job whose lock outlives a conversion. */
const MAX_OVERLAP_RELEASES = Math.ceil((JOB_TIMEOUT_SECONDS + 200) / OVERLAP_RELEASE_SECONDS);

function track<T>(promise: Promise<T>): Promise<T> {
  activeHandlers.add(promise);
  const remove = () => activeHandlers.delete(promise);
  promise.then(remove, remove);
  return promise;
}

function runContext(job: JobWithMetadata<unknown>): JobRunContext {
  return { attempt: job.retryCount + 1, maxAttempts: job.retryLimit + 1, signal: job.signal };
}

/** The error a dead-lettered job failed with (pg-boss stores the serialized error as its output). */
function failureFromOutput(output: unknown): Error {
  if (output && typeof output === "object" && "message" in output && typeof output.message === "string") {
    return new Error(output.message);
  }
  return new Error("The upload job failed after all attempts.");
}

async function processUpload(job: JobWithMetadata<AssembleGeodataUploadPayload>): Promise<void> {
  const payload = job.data;
  const locked = await withConversionLock(payload.conversionJobId, () => runAssembleGeodataUpload(payload, runContext(job)));
  if (locked.acquired) return;

  // Another worker still runs this conversion: put the job back for later (releaseAfter(60)).
  const releases = (payload.overlapReleases ?? 0) + 1;
  if (releases > MAX_OVERLAP_RELEASES) {
    throw new Error(`Conversion ${payload.conversionJobId} is still locked by another worker.`);
  }
  await enqueueAssembleGeodataUpload({ ...payload, overlapReleases: releases }, OVERLAP_RELEASE_SECONDS);
  log.info(`AssembleGeodataUpload: conversion ${payload.conversionJobId} is locked by another worker; released for ${OVERLAP_RELEASE_SECONDS}s.`);
}

/** Subscribes the worker to every queue. One job at a time per queue, like `queue:work`. */
export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work(
    QUEUES.upload,
    { includeMetadata: true, batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 3 },
    async (jobs: JobWithMetadata<AssembleGeodataUploadPayload>[]) => {
      for (const job of jobs) {
        await track(processUpload(job));
      }
    },
  );

  await boss.work(
    QUEUES.uploadFailed,
    { includeMetadata: true, batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 3 },
    async (jobs: JobWithMetadata<AssembleGeodataUploadPayload>[]) => {
      for (const job of jobs) {
        const error = failureFromOutput(job.sourceOutput);
        log.error(`AssembleGeodataUpload failed for conversion ${job.data.conversionJobId}: ${error.message}`);
        await track(failAssembleGeodataUpload(job.data, error));
      }
    },
  );

  await boss.work(
    QUEUES.default,
    { includeMetadata: true, batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 3 },
    async (jobs: JobWithMetadata<CleanupLayerFilesPayload>[]) => {
      for (const job of jobs) {
        await track(runCleanupLayerFiles(job.data));
      }
    },
  );

  await boss.work(
    QUEUES.cleanupStale,
    { includeMetadata: true, batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 5 },
    async (jobs: JobWithMetadata<CleanupStaleUploadsPayload | null>[]) => {
      for (const job of jobs) {
        try {
          await track(cleanupStaleUploads({ hours: job.data?.hours ?? 20 }));
        } catch (error) {
          log.error(`geodata:cleanup-stale failed: ${errorMessage(error)}`);
          throw error;
        }
      }
    },
  );
}
