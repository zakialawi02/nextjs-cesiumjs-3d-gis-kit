import type { CleanupLayerFilesPayload } from "@/server/jobs/types";
import { log } from "@/server/logger";
import { storage } from "@/server/storage";
import { dropVectorTable } from "@/server/services/database/dynamic-table-service";
import { errorMessage } from "@/server/services/support";

/**
 * Queue `default` (port of CleanupLayerFilesJob): after a layer's rows were deleted, drops its
 * vector table and removes its tiles and source files. A failed file deletion is rethrown so the
 * job is retried.
 */
export async function runCleanupLayerFiles(payload: CleanupLayerFilesPayload): Promise<void> {
  if (payload.physicalTableName) {
    try {
      await dropVectorTable(payload.physicalTableName);
    } catch (error) {
      log.error(`Background PostGIS table drop failed: ${errorMessage(error)}`, { table_name: payload.physicalTableName });
    }
  }

  try {
    for (const directory of payload.directoriesToDelete) {
      if (await storage.exists("public", directory)) await storage.deleteDirectory("public", directory);
    }
    for (const file of payload.filesToDeletePublic) {
      if (await storage.exists("public", file)) await storage.delete("public", file);
    }
    for (const file of payload.filesToDelete) {
      if (await storage.exists("geodata", file)) await storage.delete("geodata", file);
    }
  } catch (error) {
    log.error(`Background file cleanup failed: ${errorMessage(error)}`, {
      directories: payload.directoriesToDelete,
      files_public: payload.filesToDeletePublic,
      files_geodata: payload.filesToDelete,
    });
    throw error;
  }
}
