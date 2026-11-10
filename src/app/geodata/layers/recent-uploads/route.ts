import { JOB_STATUS_LABELS, JobStatus, UserRole } from "@/lib/enums";
import { diffForHumans } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /geodata/layers/recent-uploads (GeodataLayerController::listRecentUploads, admin only):
 * the latest conversion jobs for the Data panel.
 */
export const GET = handler(async () => {
  await requireApiUser(UserRole.Admin);

  const jobs = await prisma.conversionJob.findMany({
    include: {
      source_file: { select: { id: true, original_name: true } },
      layer: { select: { id: true, job_id: true, name: true, layer_type: true } },
    },
    orderBy: { created_at: "desc" },
    take: 10,
  });

  return json({
    success: true,
    jobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      status_label: JOB_STATUS_LABELS[job.status as JobStatus] ?? job.status,
      layer_type: job.layer_type,
      layer_name: job.layer?.name ?? job.source_file?.original_name ?? "Processing...",
      time_diff: diffForHumans(job.finished_at ?? job.created_at),
      is_done: job.status === JobStatus.Done,
      is_failed: job.status === JobStatus.Failed,
    })),
  });
});
