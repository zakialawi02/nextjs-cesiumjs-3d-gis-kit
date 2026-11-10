import { JobStatus, LayerStatus, SourceFileStatus } from "@/lib/enums";
import { prisma } from "@/lib/prisma";

/**
 * Database side of a terminal conversion failure, shared by the queue failure handler and by the
 * upload API when a job cannot be queued at all (so the UI never waits on a job nobody runs).
 */

/** Job → failed, its layer → process_failed. */
export async function markConversionJobFailed(conversionJobId: string, message: string): Promise<void> {
  await prisma.conversionJob.updateMany({
    where: { id: conversionJobId },
    data: { status: JobStatus.Failed, error_message: message, finished_at: new Date() },
  });
  await prisma.layer.updateMany({ where: { job_id: conversionJobId }, data: { status: LayerStatus.ProcessFailed } });
}

/** Upload sessions → failed; source files still uploading → invalid (AssembleGeodataUpload::failed()). */
export async function markUploadInputsFailed(conversionJobId: string): Promise<void> {
  await prisma.uploadSession.updateMany({ where: { conversion_job_id: conversionJobId }, data: { status: "failed" } });
  const job = await prisma.conversionJob.findUnique({
    where: { id: conversionJobId },
    select: { source_file_id: true, ortho_file_id: true },
  });
  if (!job) return;
  const ids = [job.source_file_id, job.ortho_file_id].filter((id): id is string => Boolean(id));
  await prisma.sourceFile.updateMany({
    where: { id: { in: ids }, status: SourceFileStatus.Uploading },
    data: { status: SourceFileStatus.Invalid },
  });
}
