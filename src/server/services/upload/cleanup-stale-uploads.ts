import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { JobStatus, SourceFileStatus } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { log, type Logger } from "@/server/logger";
import { storage } from "@/server/storage";
import { isUuid } from "@/server/services/support";
import { sessionDirectory } from "@/server/services/upload/upload-session-service";

/**
 * `geodata:cleanup-stale` (port of CleanupStaleUploads): removes expired upload sessions with their
 * chunks, source files stuck in uploading / invalid for `hours`, and orphaned chunk directories.
 * Queued sessions are never touched: their inputs belong to the worker until it finishes.
 */
export type CleanupStaleResult = { sessions: number; sourceFiles: number; chunkDirectories: number };

const ACTIVE_JOB_STATUSES = [JobStatus.Queued, JobStatus.Processing];

export async function cleanupStaleUploads({ hours = 20, logger = log }: { hours?: number; logger?: Logger } = {}): Promise<CleanupStaleResult> {
  if (!Number.isInteger(hours) || hours < 1) {
    throw new Error("The hours option must be positive.");
  }
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);

  // Expired sessions, each re-checked under a row lock against concurrent chunk writes / completion.
  let sessions = 0;
  const candidates = await prisma.uploadSession.findMany({
    where: { expires_at: { lt: new Date() }, status: { not: "queued" } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const candidate of candidates) {
    const deleted = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM upload_sessions WHERE id = ${candidate.id}::uuid FOR UPDATE`;
      const session = await tx.uploadSession.findUnique({ where: { id: candidate.id } });
      if (!session || session.status === "queued" || session.expires_at.getTime() > Date.now()) return false;
      await fs.rm(sessionDirectory(session), { recursive: true, force: true });
      await tx.uploadSession.delete({ where: { id: session.id } });
      return true;
    });
    if (deleted) sessions++;
  }

  // Source files stuck in uploading / invalid that no queued or running job still needs.
  const stale = await prisma.sourceFile.findMany({
    where: {
      status: { in: [SourceFileStatus.Uploading, SourceFileStatus.Invalid] },
      created_at: { lt: cutoff },
      conversion_jobs: { none: { status: { in: ACTIVE_JOB_STATUSES } } },
      ortho_conversion_jobs: { none: { status: { in: ACTIVE_JOB_STATUSES } } },
    },
    include: { _count: { select: { conversion_jobs: true, ortho_conversion_jobs: true } } },
  });

  let sourceFiles = 0;
  for (const file of stale) {
    try {
      await storage.delete("geodata", file.storage_path);
      await storage.delete("geodata", `${file.storage_path}.assembling`);
    } catch (error) {
      logger.warning(`Skipping files of source ${file.id}: ${(error as Error).message}`);
    }
    // Source metadata referenced by failed conversion jobs is kept.
    if (file._count.conversion_jobs === 0 && file._count.ortho_conversion_jobs === 0) {
      await prisma.sourceFile.delete({ where: { id: file.id } }).catch(() => undefined);
    }
    sourceFiles++;
  }
  logger.info(`Cleaned up ${sourceFiles} stale upload(s).`);

  // Chunk directories without a session row.
  let chunkDirectories = 0;
  const tempChunks = storage.path("local", "temp_chunks");
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(tempChunks, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (isUuid(entry.name) && (await prisma.uploadSession.count({ where: { id: entry.name } })) > 0) continue;
    const directory = path.join(tempChunks, entry.name);
    try {
      const stats = await fs.lstat(directory);
      if (stats.isSymbolicLink()) continue;
      if (stats.mtime.getTime() < cutoff.getTime()) {
        await fs.rm(directory, { recursive: true, force: true });
        chunkDirectories++;
      }
    } catch {
      // Removed concurrently.
    }
  }
  if (chunkDirectories > 0) {
    logger.info(`Cleaned up ${chunkDirectories} stale temp chunk directory/directories.`);
  }

  return { sessions, sourceFiles, chunkDirectories };
}
