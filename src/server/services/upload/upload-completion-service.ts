import { createHash } from "node:crypto";

import type { ConversionJob, Prisma, SourceFile, UploadSession } from "@prisma/client";

import { JobStatus, LayerStatus, LayerType, SourceFileStatus, SourceFileType } from "@/lib/enums";
import { slugify } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { markConversionJobFailed, markUploadInputsFailed } from "@/server/jobs/conversion-failure";
import type { AssembleGeodataUploadPayload } from "@/server/jobs/types";
import { HttpError, abort, abortIf, abortUnless } from "@/server/http";
import { log } from "@/server/logger";
import { enqueueAssembleGeodataUpload } from "@/server/queue";
import { errorMessage, fileExtension, randomString, ulid } from "@/server/services/support";
import { assertComplete, findOwnedSession } from "@/server/services/upload/upload-session-service";

/**
 * Turns completed upload sessions into a source file, a queued conversion job and a processing
 * layer, then queues AssembleGeodataUpload (port of UploadCompletionService). Idempotent: the
 * normalized parameters are hashed into upload_sessions.completion_hash, so a retried request gets
 * the same job and a request with different parameters gets a 409.
 */
export type CompletionData = {
  layerName: string;
  sourceEpsg?: string | null;
  acquisitionDate?: string | null;
  layer_category_id?: string | null;
  /** Terrain uploads */
  demIdentifier?: string;
  orthoIdentifier?: string | null;
  /** Vector uploads */
  identifier?: string;
};

export type CompletionType = typeof LayerType.Terrain | typeof LayerType.Vector;

type Enqueue = (payload: AssembleGeodataUploadPayload) => Promise<unknown>;

const TERRAIN_EXTENSIONS = ["tif", "tiff", "geotiff"];
const VECTOR_EXTENSIONS = ["geojson", "zip", "str", "dxf", "dwg"];

export function completionHash(data: CompletionData, type: CompletionType): string {
  const primary = type === LayerType.Terrain ? data.demIdentifier : data.identifier;
  // Only immutable, normalized completion parameters; not client filenames or counts.
  const parameters = {
    type,
    primary: primary ?? null,
    ortho: data.orthoIdentifier ?? null,
    name: data.layerName,
    epsg: data.sourceEpsg ?? null,
    date: data.acquisitionDate ?? null,
    category: data.layer_category_id ?? null,
  };
  return createHash("sha256").update(JSON.stringify(parameters)).digest("hex");
}

async function createSource(tx: Prisma.TransactionClient, session: UploadSession): Promise<SourceFile> {
  const extension = fileExtension(session.file_name).toLowerCase();
  const id = ulid();
  const subdirectory = TERRAIN_EXTENSIONS.includes(extension) ? "geotiff" : "vectors";
  const source = await tx.sourceFile.create({
    data: {
      id,
      original_name: session.file_name,
      stored_name: `${id}.${extension}`,
      file_type: extension === "zip" ? SourceFileType.Shapefile : extension,
      file_size: session.file_size,
      mime_type: "application/octet-stream",
      storage_path: `${subdirectory}/${id}.${extension}`,
      checksum_sha256: "0".repeat(64),
      status: SourceFileStatus.Uploading,
    },
  });
  await tx.uploadSession.update({ where: { id: session.id }, data: { source_file_id: id } });
  return source;
}

export async function completeUpload(
  data: CompletionData,
  type: CompletionType,
  userId: string,
  { enqueue = enqueueAssembleGeodataUpload }: { enqueue?: Enqueue } = {},
): Promise<ConversionJob> {
  const primaryId = type === LayerType.Terrain ? data.demIdentifier : data.identifier;
  if (!primaryId) abort(422, "The given data was invalid.");
  const orthoId = data.orthoIdentifier ?? null;
  const ids = [primaryId, orthoId].filter((id): id is string => Boolean(id)).sort();
  const hash = completionHash(data, type);

  const result = await prisma.$transaction(
    async (tx) => {
      // Lock in a stable order so concurrent completions cannot deadlock.
      const sessions = new Map<string, UploadSession>();
      for (const id of ids) sessions.set(id, await findOwnedSession(tx, id, userId, true));
      const primary = sessions.get(primaryId)!;

      if (primary.conversion_job_id) {
        for (const session of sessions.values()) {
          abortUnless(
            session.conversion_job_id === primary.conversion_job_id && session.completion_hash === hash,
            409,
            "Upload was already submitted with different parameters.",
          );
        }
        const existing = await tx.conversionJob.findUnique({ where: { id: primary.conversion_job_id } });
        if (!existing) abort(404);
        return { job: existing, created: false };
      }

      for (const session of sessions.values()) {
        await assertComplete(session);
        const extension = fileExtension(session.file_name).toLowerCase();
        const allowed = type === LayerType.Terrain ? TERRAIN_EXTENSIONS : VECTOR_EXTENSIONS;
        abortUnless(allowed.includes(extension), 422, "File format does not match this upload workflow.");
        if (["str", "dxf", "dwg"].includes(extension)) {
          abortIf(!data.sourceEpsg, 422, "Source EPSG is required for CAD/STR files.");
        }
      }

      const source = await createSource(tx, primary);
      const orthoSource = orthoId ? await createSource(tx, sessions.get(orthoId)!) : null;
      const job = await tx.conversionJob.create({
        data: {
          layer_type: type,
          source_file_id: source.id,
          ortho_file_id: orthoSource?.id ?? null,
          status: JobStatus.Queued,
          conversion_tool: "upload/assembly",
        },
      });

      let categoryId = data.layer_category_id ?? null;
      if (!categoryId) {
        const other = await tx.layerCategory.findUnique({ where: { slug: "other" }, select: { id: true } });
        categoryId = other?.id ?? null;
      }
      await tx.layer.create({
        data: {
          user_id: userId,
          job_id: job.id,
          name: data.layerName,
          slug: `${slugify(data.layerName)}-${randomString(8)}`,
          layer_type: type,
          status: LayerStatus.Processing,
          layer_category_id: categoryId,
        },
      });

      for (const session of sessions.values()) {
        await tx.uploadSession.update({
          where: { id: session.id },
          data: { status: "queued", conversion_job_id: job.id, completion_hash: hash },
        });
      }
      return { job, created: true };
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  if (result.created) {
    // Dispatched after commit, so the worker always finds the rows.
    try {
      await enqueue({
        conversionJobId: result.job.id,
        layerName: data.layerName,
        sourceEpsg: data.sourceEpsg ?? null,
        acquisitionDate: data.acquisitionDate ?? null,
      });
    } catch (error) {
      log.error(`Unable to queue conversion job ${result.job.id}: ${errorMessage(error)}`);
      await markConversionJobFailed(result.job.id, `The upload could not be queued for processing: ${errorMessage(error)}`);
      await markUploadInputsFailed(result.job.id);
      throw new HttpError(503, "The upload could not be queued for processing. Please try again later.");
    }
  }

  return result.job;
}
