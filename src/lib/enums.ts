/**
 * String enums stored in the database (port of app/Enums). Columns are plain strings, so these
 * constant objects are the single source of allowed values.
 */

export const UserRole = {
  Admin: "admin",
  Engineering: "engineering",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLES: UserRole[] = Object.values(UserRole);
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  engineering: "Engineering",
};

export const LayerType = {
  Terrain: "terrain",
  Vector: "vector",
  Imagery: "imagery",
} as const;
export type LayerType = (typeof LayerType)[keyof typeof LayerType];
export const LAYER_TYPES: LayerType[] = Object.values(LayerType);

export const LayerStatus = {
  Pending: "pending",
  Queued: "queued",
  Processing: "processing",
  Published: "published",
  ProcessFailed: "process_failed",
  Archived: "archived",
} as const;
export type LayerStatus = (typeof LayerStatus)[keyof typeof LayerStatus];
export const LAYER_STATUSES: LayerStatus[] = Object.values(LayerStatus);

export const JobStatus = {
  Queued: "queued",
  Processing: "processing",
  Done: "done",
  Failed: "failed",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  done: "Done",
  failed: "Failed",
};

export const SourceFileStatus = {
  Uploading: "uploading",
  Uploaded: "uploaded",
  Validating: "validating",
  Ready: "ready",
  Invalid: "invalid",
} as const;
export type SourceFileStatus = (typeof SourceFileStatus)[keyof typeof SourceFileStatus];

export const SourceFileType = {
  Las: "las",
  Laz: "laz",
  Obj: "obj",
  Glb: "glb",
  Gltf: "gltf",
  Tif: "tif",
  Tiff: "tiff",
  Geotiff: "geotiff",
  Shapefile: "shapefile",
  Geojson: "geojson",
  Dxf: "dxf",
  Dwg: "dwg",
  Str: "str",
} as const;
export type SourceFileType = (typeof SourceFileType)[keyof typeof SourceFileType];

export const TerrainOutputType = {
  Pnts: "pnts",
  B3dm: "b3dm",
  Terrain: "terrain",
} as const;
export type TerrainOutputType = (typeof TerrainOutputType)[keyof typeof TerrainOutputType];

export const VectorOutputType = {
  Mvt: "mvt",
  Geojson: "geojson",
  Flatgeobuf: "flatgeobuf",
} as const;
export type VectorOutputType = (typeof VectorOutputType)[keyof typeof VectorOutputType];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as string[]).includes(value);
}
