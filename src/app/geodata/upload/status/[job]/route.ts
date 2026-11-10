import { JobStatus, LayerType } from "@/lib/enums";
import { diffForHumans } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { presentTerrainDetail, presentVectorDetail } from "@/server/geodata/presenters";
import { abort, abortUnless, handler, json } from "@/server/http";
import { isUlid, toIso8601String } from "@/server/services/support";

import { requireUploader } from "../../_lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /geodata/upload/status/{job} (GeodataUploadController::status): polling endpoint of the
 * upload UI. Only the uploader of the layer may read it; details are added once the job is done.
 */
export const GET = handler<{ job: string }>(async (_request, { params }) => {
  const user = await requireUploader("upload-status");
  const { job: jobId } = await params;
  if (!isUlid(jobId)) abort(404);

  const job = await prisma.conversionJob.findUnique({
    where: { id: jobId },
    include: { layer: { include: { terrain_detail: true, vector_detail: true } }, source_file: true },
  });
  if (!job) abort(404);
  abortUnless(job.layer?.user_id === user.id, 404);

  const data: Record<string, unknown> = {
    success: true,
    status: job.status,
    error_message: job.status === JobStatus.Failed ? "File processing failed. Please contact an administrator with the job ID." : null,
    finished_at: toIso8601String(job.finished_at),
  };

  if (job.status === JobStatus.Done) {
    const layer = job.layer;
    if (layer) {
      const payload: Record<string, unknown> = {
        id: layer.id,
        name: layer.name,
        type: layer.layer_type,
        created_at: diffForHumans(layer.created_at),
      };
      if (layer.layer_type === LayerType.Terrain) {
        payload.terrain_detail = layer.terrain_detail ? presentTerrainDetail(layer.terrain_detail) : null;
      } else if (layer.layer_type === LayerType.Vector) {
        payload.vector_detail = layer.vector_detail ? presentVectorDetail(layer.vector_detail) : null;
      }
      data.layer = payload;
    }
    if (job.source_file) {
      data.source_file = { name: job.source_file.original_name, size: Number(job.source_file.file_size) };
    }
  }

  return json(data);
});
