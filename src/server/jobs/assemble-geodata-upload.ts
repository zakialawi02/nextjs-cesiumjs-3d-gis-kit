import type { ConversionJob } from "@prisma/client";

import { JobStatus, LayerType } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { BaseConversionJob } from "@/server/jobs/base-conversion-job";
import { markUploadInputsFailed } from "@/server/jobs/conversion-failure";
import { ProcessGeotiffTerrain } from "@/server/jobs/process-geotiff-terrain";
import { ProcessVectorLayer } from "@/server/jobs/process-vector-layer";
import type { AssembleGeodataUploadPayload, JobRunContext } from "@/server/jobs/types";
import { log, type LogChannel } from "@/server/logger";
import { assembleUploadSession } from "@/server/services/upload/file-assembly-service";

/**
 * Queue `upload` (port of AssembleGeodataUpload): assembles the uploaded chunks and runs the
 * terrain or vector conversion in the same queue reservation, so there is no hand-off window in
 * which a job could be lost between "assembled" and "converting".
 */
export class AssembleGeodataUpload extends BaseConversionJob {
  constructor(
    conversionJob: ConversionJob,
    layerName: string,
    protected readonly sourceEpsg: string | null = null,
    acquisitionDate: string | null = null,
    context?: JobRunContext,
  ) {
    super(conversionJob, layerName, acquisitionDate, context);
  }

  protected getLogChannel(): LogChannel {
    return this.conversionJob.layer_type === LayerType.Terrain ? "terrain_conversion" : "vector_conversion";
  }

  protected getTotalSteps(): number {
    return 1;
  }

  async handle(): Promise<void> {
    const fresh = await prisma.conversionJob.findUnique({ where: { id: this.conversionJob.id } });
    if (!fresh || fresh.status === JobStatus.Done) return;
    this.conversionJob = fresh;

    await this.updateConversionJob({ status: JobStatus.Processing, error_message: null, finished_at: null });

    const sessions = await prisma.uploadSession.findMany({ where: { conversion_job_id: this.conversionJob.id }, orderBy: { id: "asc" } });
    for (const session of sessions) {
      await assembleUploadSession(session);
    }

    const job = await prisma.conversionJob.findUniqueOrThrow({ where: { id: this.conversionJob.id } });
    if (job.layer_type === LayerType.Terrain) {
      await new ProcessGeotiffTerrain(job, this.layerName, this.acquisitionDate, this.context).handle();
    } else {
      await new ProcessVectorLayer(job, this.layerName, this.sourceEpsg, this.acquisitionDate, this.context).handle();
    }
  }

  async failed(error: unknown): Promise<void> {
    await super.failed(error);
    await markUploadInputsFailed(this.conversionJob.id);
  }
}

async function loadJob(payload: AssembleGeodataUploadPayload, context?: JobRunContext): Promise<AssembleGeodataUpload | null> {
  const conversionJob = await prisma.conversionJob.findUnique({ where: { id: payload.conversionJobId } });
  if (!conversionJob) {
    // The layer (and its job) was deleted while the upload waited in the queue.
    log.warning(`AssembleGeodataUpload: conversion job ${payload.conversionJobId} no longer exists; skipping.`);
    return null;
  }
  return new AssembleGeodataUpload(conversionJob, payload.layerName, payload.sourceEpsg, payload.acquisitionDate, context);
}

/** Queue handler of `upload`. */
export async function runAssembleGeodataUpload(payload: AssembleGeodataUploadPayload, context: JobRunContext): Promise<void> {
  const job = await loadJob(payload, context);
  await job?.handle();
}

/** Queue handler of `upload-failed` (the job's failed() hook). */
export async function failAssembleGeodataUpload(payload: AssembleGeodataUploadPayload, error: unknown): Promise<void> {
  const job = await loadJob(payload);
  if (!job) return;
  if (job.conversionJob.status === JobStatus.Done) {
    // A handler that outlived its reservation still finished the conversion.
    log.warning(`AssembleGeodataUpload: conversion job ${payload.conversionJobId} is done; ignoring the queue failure.`);
    return;
  }
  await job.failed(error);
}
