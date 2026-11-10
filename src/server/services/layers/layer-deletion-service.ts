import type { ConversionJob, SourceFile } from "@prisma/client";

import { JobStatus, LayerType } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { forgetPublishedLayer } from "@/server/geodata/published-layer";
import { runCleanupLayerFiles } from "@/server/jobs/cleanup-layer-files-job";
import type { CleanupLayerFilesPayload } from "@/server/jobs/types";
import { log } from "@/server/logger";
import { enqueueCleanupLayerFiles } from "@/server/queue";
import { generateTableName } from "@/server/services/database/dynamic-table-service";
import { errorMessage } from "@/server/services/support";

/**
 * Layer deletion (port of GeodataController::destroy). Every output path is derived from the
 * layer id as well as from the detail rows (which conversions fill only at the end), so failed or
 * unfinished layers are cleaned up completely. Rows go in one transaction; tables and files are
 * removed afterwards by CleanupLayerFilesJob.
 */

/**
 * A queued / processing job untouched for longer than this is treated as dead and may be deleted.
 * Must exceed the longest conversion timeout (7200 s).
 */
export const STALE_JOB_SECONDS = 3 * 60 * 60;

/** True while a conversion may still write outputs for the layer. */
export function isConversionRunning(job: Pick<ConversionJob, "status" | "updated_at"> | null | undefined, now: Date = new Date()): boolean {
  if (!job || (job.status !== JobStatus.Queued && job.status !== JobStatus.Processing)) return false;
  if (!job.updated_at) return true;
  return (now.getTime() - job.updated_at.getTime()) / 1000 < STALE_JOB_SECONDS;
}

export type DeleteLayerResult =
  | { status: "deleted"; cleanup: CleanupLayerFilesPayload }
  | { status: "running" }
  | { status: "not_found" };

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export async function deleteLayer(layerId: string): Promise<DeleteLayerResult> {
  const layer = await prisma.layer.findUnique({ where: { id: layerId }, include: { job: true } });
  if (!layer) return { status: "not_found" };
  if (isConversionRunning(layer.job)) return { status: "running" };

  const isTerrain = layer.layer_type === LayerType.Terrain;
  let directoriesToDelete: string[] = [];
  const filesToDelete: string[] = [];
  let physicalTableName: string | null = null;

  if (isTerrain) {
    directoriesToDelete = [`terrain-tiles/${layer.id}`, `xyz-tiles/${layer.id}_ortho`];
  } else {
    physicalTableName = generateTableName(layer.id);
    filesToDelete.push(`geojson/vector_${layer.id}.geojson`);
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.layer.findUnique({
      where: { id: layer.id },
      include: {
        job: { include: { source_file: true, ortho_file: true } },
        terrain_detail: { include: { source_file: true, ortho_file: true } },
        vector_detail: { include: { source_file: true } },
      },
    });
    if (!current) return;

    const job = current.job;
    const files: Array<SourceFile | null | undefined> = [job?.source_file, job?.ortho_file];

    if (isTerrain && current.terrain_detail) {
      const detail = current.terrain_detail;
      files.push(detail.source_file, detail.ortho_file);
      directoriesToDelete.push(...[detail.tileset_path, detail.ortho_tiles_path].filter((value): value is string => Boolean(value)));
    } else if (current.layer_type === LayerType.Vector && current.vector_detail) {
      const detail = current.vector_detail;
      files.push(detail.source_file);
      physicalTableName = detail.physical_table_name || physicalTableName;
      if (detail.output_path) {
        filesToDelete.push(detail.output_path.startsWith("geodata/") ? detail.output_path.slice("geodata/".length) : detail.output_path);
      }
    }

    // The layer references the job with "restrict", so it goes first (details cascade).
    await tx.layer.delete({ where: { id: current.id } });

    if (job) {
      await tx.conversionLog.deleteMany({ where: { job_id: job.id } });
      await tx.uploadSession.deleteMany({ where: { conversion_job_id: job.id } });
      await tx.conversionJob.delete({ where: { id: job.id } });
    }

    const seen = new Set<string>();
    for (const file of files) {
      if (!file || seen.has(file.id)) continue;
      seen.add(file.id);
      filesToDelete.push(file.storage_path);
      if (isTerrain) {
        // Reprojected copy written next to the source by TerrainConversionService.reproject().
        filesToDelete.push(`${file.storage_path}_wgs84.tif`);
      }
      await tx.sourceFile.delete({ where: { id: file.id } });
    }
  });
  // Tiles stay on disk until the cleanup job runs: stop serving them right away.
  forgetPublishedLayer(layer.id);

  return {
    status: "deleted",
    cleanup: {
      directoriesToDelete: unique(directoriesToDelete),
      filesToDeletePublic: [],
      filesToDelete: unique(filesToDelete),
      physicalTableName,
      layerType: layer.layer_type,
    },
  };
}

/** Queues the file / table cleanup; runs it in this process when the queue is unavailable. */
export async function dispatchLayerCleanup(cleanup: CleanupLayerFilesPayload): Promise<void> {
  try {
    await enqueueCleanupLayerFiles(cleanup);
  } catch (error) {
    log.error(`Unable to queue layer file cleanup, running it now: ${errorMessage(error)}`);
    await runCleanupLayerFiles(cleanup).catch((cleanupError: unknown) => {
      log.error(`Layer file cleanup failed: ${errorMessage(cleanupError)}`, { ...cleanup });
    });
  }
}
