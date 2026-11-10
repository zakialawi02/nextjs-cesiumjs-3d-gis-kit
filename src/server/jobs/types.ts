/**
 * Queue payloads (what Laravel serialized into its job classes). Only ids and plain values: the
 * handlers reload rows from the database.
 */
export type AssembleGeodataUploadPayload = {
  conversionJobId: string;
  layerName: string;
  sourceEpsg: string | null;
  acquisitionDate: string | null;
  /** How often the job was put back because another worker held its conversion lock. */
  overlapReleases?: number;
};

export type CleanupLayerFilesPayload = {
  /** Directories on the public disk (terrain-tiles/<id>, xyz-tiles/<id>_ortho). */
  directoriesToDelete: string[];
  /** Files on the public disk. */
  filesToDeletePublic: string[];
  /** Files on the geodata disk. */
  filesToDelete: string[];
  physicalTableName: string | null;
  layerType: string | null;
};

export type CleanupStaleUploadsPayload = {
  hours?: number;
};

/**
 * What a handler knows about its queue reservation (Laravel's InteractsWithQueue): the attempt
 * number, how many attempts the job has, and a signal aborted when the job times out or the
 * worker shuts down.
 */
export type JobRunContext = {
  attempt: number;
  maxAttempts: number;
  signal?: AbortSignal;
};

export const SYNC_CONTEXT: JobRunContext = { attempt: 1, maxAttempts: 1 };
