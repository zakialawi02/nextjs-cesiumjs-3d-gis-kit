// Server-side only (reads secrets-free env, but must not be bundled for the browser). Also imported
// by the queue worker, so it must not use the "server-only" package (that throws outside Next.js).
import { env } from "@/env";
import { buildUtmConfig, type UtmConfig } from "@/lib/utm";

/**
 * Geodata upload, conversion and display settings (port of Laravel's config/geodata.php).
 */
export const geodataConfig = {
  /** Maximum size of one uploaded file, in megabytes. */
  maxUploadMb: env.GEODATA_MAX_UPLOAD_MB,
  enablePythonColorParser: env.GEODATA_ENABLE_PYTHON_COLOR_PARSER,

  /** docker-compose file holding the GDAL and CTB converter services (relative to the project root). */
  dockerComposeFile: env.GEODATA_DOCKER_COMPOSE_FILE,
  /** Command used to run docker compose: "docker compose" or "docker-compose". */
  dockerComposeBin: env.GEODATA_DOCKER_COMPOSE_BIN,

  allowedExtensions: ["tif", "tiff", "geotiff", "geojson", "dxf", "dwg", "str", "zip"] as const,

  upload: {
    chunkBytes: 2 * 1024 * 1024,
    sessionHours: env.GEODATA_UPLOAD_SESSION_HOURS,
    maxActiveSessions: env.GEODATA_UPLOAD_MAX_SESSIONS,
    maxInflightMb: env.GEODATA_UPLOAD_MAX_INFLIGHT_MB,
    minFreeDiskMb: env.GEODATA_MIN_FREE_DISK_MB,
    zipMaxEntries: 1000,
    zipMaxUncompressedMb: env.GEODATA_ZIP_MAX_UNCOMPRESSED_MB,
    zipMaxRatio: 100,
  },

  utm: buildUtmConfig(env.GIS_UTM_ZONE, env.GIS_UTM_HEMISPHERE) satisfies UtmConfig,

  terrain: {
    maxZoom: env.GEODATA_TERRAIN_MAX_ZOOM,
    minZoom: env.GEODATA_TERRAIN_MIN_ZOOM,
  },
} as const;

export type GeodataConfig = typeof geodataConfig;
