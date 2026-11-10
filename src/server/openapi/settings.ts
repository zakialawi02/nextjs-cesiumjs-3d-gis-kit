// Plain server module (no "server-only"): also imported by scripts/export-openapi.ts under tsx.
import { geodataConfig } from "@/config/geodata";
import { env } from "@/env";
import { RATE_LIMITS, type RateLimitName } from "@/server/rate-limit";

/**
 * Values the OpenAPI document reads from the running configuration, so the documented limits
 * follow .env (GEODATA_MAX_UPLOAD_MB, ...) instead of going stale.
 */
export type OpenApiSettings = {
  appName: string;
  /** Idle session lifetime without "Remember me", in minutes (SESSION_LIFETIME). */
  sessionLifetimeMinutes: number;
  maxUploadMb: number;
  chunkBytes: number;
  sessionHours: number;
  maxActiveSessions: number;
  maxInflightMb: number;
  minFreeDiskMb: number;
  zipMaxEntries: number;
  zipMaxUncompressedMb: number;
  zipMaxRatio: number;
  allowedExtensions: readonly string[];
  /** EPSG code of the configured UTM zone, used in examples. */
  defaultEpsg: string;
  terrainMinZoom: number;
  terrainMaxZoom: number;
  rateLimits: Record<RateLimitName, number>;
};

export function currentOpenApiSettings(): OpenApiSettings {
  const { upload } = geodataConfig;
  return {
    appName: env.APP_NAME,
    sessionLifetimeMinutes: env.SESSION_LIFETIME,
    maxUploadMb: geodataConfig.maxUploadMb,
    chunkBytes: upload.chunkBytes,
    sessionHours: upload.sessionHours,
    maxActiveSessions: upload.maxActiveSessions,
    maxInflightMb: upload.maxInflightMb,
    minFreeDiskMb: upload.minFreeDiskMb,
    zipMaxEntries: upload.zipMaxEntries,
    zipMaxUncompressedMb: upload.zipMaxUncompressedMb,
    zipMaxRatio: upload.zipMaxRatio,
    allowedExtensions: geodataConfig.allowedExtensions,
    defaultEpsg: geodataConfig.utm.epsg,
    terrainMinZoom: geodataConfig.terrain.minZoom,
    terrainMaxZoom: geodataConfig.terrain.maxZoom,
    rateLimits: { ...RATE_LIMITS },
  };
}
