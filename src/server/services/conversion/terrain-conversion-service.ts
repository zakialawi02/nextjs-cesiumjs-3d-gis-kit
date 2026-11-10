import fs from "node:fs/promises";

import type { SourceFile } from "@prisma/client";

import { logChannel } from "@/server/logger";
import { storage } from "@/server/storage";
import { runDockerCompose } from "@/server/services/conversion/docker";
import type { ProcessResult } from "@/server/services/process";

/**
 * Zoom range of the orthophoto XYZ tiles. Stored on terrain_details so the map never requests
 * levels that were not generated (Cesium upsamples the deepest level instead).
 */
export const ORTHO_MIN_ZOOM = 10;
export const ORTHO_MAX_ZOOM = 18;

/**
 * GeoTIFF DEM / orthophoto pipeline steps (port of TerrainConversionService), each one a
 * `docker compose run` of the gdal or ctb converter on files of the geodata disk (/data/geodata)
 * writing to the public disk (/data/terrain-tiles, /data/xyz-tiles).
 */
const GEOTIFF_PREFIX = "geotiff/";
const logger = logChannel("terrain_conversion");

export type BoundingBox = { west: number; south: number; east: number; north: number };

type GdalInfo = {
  cornerCoordinates?: Record<string, [number, number]>;
  coordinateSystem?: { wkt?: string; name?: string; id?: { authority?: string; code?: string | number } };
  bands?: Array<{ colorTable?: unknown; colorInterpretation?: string }>;
};

/** Storage path → file name inside /data/geodata/geotiff (str_replace of the prefix). */
function extractFileName(storagePath: string): string {
  return storagePath.split(GEOTIFF_PREFIX).join("");
}

function parseGdalInfo(output: string): GdalInfo | null {
  try {
    const parsed: unknown = JSON.parse(output);
    return parsed && typeof parsed === "object" ? (parsed as GdalInfo) : null;
  } catch {
    return null;
  }
}

export function calculateBoundingBox(corners: Record<string, [number, number]>): BoundingBox {
  return {
    west: Math.min(corners.upperLeft[0], corners.lowerLeft[0]),
    south: Math.min(corners.lowerLeft[1], corners.lowerRight[1]),
    east: Math.max(corners.upperRight[0], corners.lowerRight[0]),
    north: Math.max(corners.upperLeft[1], corners.upperRight[1]),
  };
}

export class TerrainConversionService {
  jobId: string | null = null;
  signal?: AbortSignal;

  setJobId(jobId: string): this {
    this.jobId = jobId;
    return this;
  }

  setSignal(signal: AbortSignal | undefined): this {
    this.signal = signal;
    return this;
  }

  private run(service: "gdal" | "ctb", toolCommand: string[]): Promise<ProcessResult> {
    return runDockerCompose(service, toolCommand, { jobId: this.jobId, signal: this.signal });
  }

  /** gdalinfo of the GeoTIFF header. */
  async validate(file: Pick<SourceFile, "storage_path">): Promise<boolean> {
    const inputName = extractFileName(file.storage_path);
    logger.info(`[VALIDATE] Checking file: ${file.storage_path}`);
    const result = await this.run("gdal", ["gdalinfo", `/data/geodata/geotiff/${inputName}`]);
    if (result.successful) {
      logger.info("[VALIDATE] Success: File is a valid GeoTIFF.");
      return true;
    }
    logger.error(`[VALIDATE] Failed for ${file.storage_path}: ${result.stderr}`);
    return false;
  }

  /** gdalwarp to EPSG:4326 (palette rasters expanded to RGBA first); returns the new storage path. */
  async reproject(file: Pick<SourceFile, "storage_path">): Promise<string> {
    const inputName = extractFileName(file.storage_path);
    const outputName = `${inputName}_wgs84.tif`;
    logger.info(`[REPROJECT] Reprojecting ${inputName} to WGS84`);

    // gdalwarp refuses to recreate an existing output, which a retried attempt may have left.
    await storage.delete("geodata", `${GEOTIFF_PREFIX}${outputName}`);

    let sourceToReproject = `/data/geodata/geotiff/${inputName}`;
    let expandedName: string | null = null;
    let result: ProcessResult;

    try {
      const colorTableType = await this.getColorTableType(file.storage_path);
      if (colorTableType !== null) {
        expandedName = `${inputName}_expanded.tif`;
        logger.info(`[EXPAND] Color table (palette) detected. Expanding to ${colorTableType}...`);
        await storage.delete("geodata", `${GEOTIFF_PREFIX}${expandedName}`);
        const expand = await this.run("gdal", [
          "gdal_translate", "-expand", colorTableType,
          "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=YES",
          `/data/geodata/geotiff/${inputName}`, `/data/geodata/geotiff/${expandedName}`,
        ]);
        if (!expand.successful) {
          logger.error(`[EXPAND] Failed to expand color table: ${expand.stderr}`);
          throw new Error(`Failed to expand color table: ${expand.stderr}`);
        }
        sourceToReproject = `/data/geodata/geotiff/${expandedName}`;
        logger.info("[EXPAND] Expansion successful.");
      }

      logger.info(`[REPROJECT] Source file path: ${sourceToReproject}`);
      result = await this.run("gdal", [
        "gdalwarp", "-t_srs", "EPSG:4326", "-r", "bilinear", "-multi",
        "-wo", "NUM_THREADS=ALL_CPUS", "--config", "GDAL_CACHEMAX", "1024", "-wm", "1024",
        "-co", "COMPRESS=LZW", "-co", "TILED=YES", "-co", "BIGTIFF=YES",
        sourceToReproject, `/data/geodata/geotiff/${outputName}`,
      ]);
    } finally {
      if (expandedName) {
        const relative = `${GEOTIFF_PREFIX}${expandedName}`;
        if (await storage.exists("geodata", relative)) {
          await storage.delete("geodata", relative);
          logger.info(`[CLEANUP] Deleted temporary expanded file: ${expandedName}`);
        }
      }
    }

    if (!result.successful) {
      logger.error(`[REPROJECT] Failed: ${result.stderr}`);
      throw new Error(`Reprojection failed: ${result.stderr}`);
    }
    logger.info(`[REPROJECT] Success: Created WGS84 file at ${outputName}`);
    return `${GEOTIFF_PREFIX}${outputName}`;
  }

  /** ctb-tile quantized-mesh tiles into terrain-tiles/<tileset id>. */
  async generateTerrain(inputPath: string, tilesetId: string): Promise<void> {
    const inputName = extractFileName(inputPath);
    const outputDir = `/data/terrain-tiles/${tilesetId}`;
    await this.ensureTilesetDirectory("terrain-tiles", tilesetId);
    logger.info(`[CTB-TILE] Generating terrain tiles for tileset #${tilesetId}`);
    const result = await this.run("ctb", ["ctb-tile", "-f", "Mesh", "-C", "-N", `/data/geodata/geotiff/${inputName}`, "-o", outputDir]);
    if (!result.successful) {
      logger.error(`[CTB-TILE] Failed: ${result.stderr}`);
      throw new Error(`Terrain generation failed: ${result.stderr}`);
    }
    logger.info(`[CTB-TILE] Success: Tiles generated in ${outputDir}`);
  }

  /** gdal2tiles.py XYZ tiles (ORTHO_MIN_ZOOM..ORTHO_MAX_ZOOM) into xyz-tiles/<layer id>_ortho; returns that path. */
  async generateOrthoTiles(inputPath: string, layerId: string): Promise<string> {
    const inputName = extractFileName(inputPath);
    const tilesetId = `${layerId}_ortho`;
    const outputDir = `/data/xyz-tiles/${tilesetId}`;
    await this.ensureTilesetDirectory("xyz-tiles", tilesetId);
    logger.info(`[GDAL2TILES] Generating XYZ ortho tiles for layer #${layerId}`);
    const result = await this.run("gdal", [
      "gdal2tiles.py", "-r", "lanczos", "-z", `${ORTHO_MIN_ZOOM}-${ORTHO_MAX_ZOOM}`, "-w", "none", "-p", "mercator", "--xyz", "--processes=4",
      `/data/geodata/geotiff/${inputName}`, outputDir,
    ]);
    if (!result.successful) {
      logger.error(`[GDAL2TILES] Failed: ${result.stderr}`);
      throw new Error(`Ortho tiles generation failed: ${result.stderr}`);
    }
    logger.info(`[GDAL2TILES] Success: Tiles generated in ${outputDir}`);
    return `xyz-tiles/${tilesetId}`;
  }

  /** ctb-tile -l: layer.json of the tileset. */
  async generateLayerJson(inputPath: string, tilesetId: string): Promise<void> {
    const inputName = extractFileName(inputPath);
    const outputDir = `/data/terrain-tiles/${tilesetId}`;
    logger.info(`[CTB-LAYER] Generating layer.json for tileset #${tilesetId}`);
    const result = await this.run("ctb", ["ctb-tile", "-f", "Mesh", "-C", "-N", "-l", `/data/geodata/geotiff/${inputName}`, "-o", outputDir]);
    if (!result.successful) {
      logger.error(`[CTB-LAYER] Failed: ${result.stderr}`);
      throw new Error(`Layer.json generation failed: ${result.stderr}`);
    }
    logger.info(`[CTB-LAYER] Success: layer.json generated in ${outputDir}`);
  }

  /** Bounding box (degrees) from gdalinfo -json corner coordinates. */
  async extractBoundingBox(filePath: string): Promise<BoundingBox> {
    const fileName = extractFileName(filePath);
    logger.info(`[METADATA] Extracting bounding box from ${fileName}`);
    const result = await this.run("gdal", ["gdalinfo", "-json", `/data/geodata/geotiff/${fileName}`]);
    if (!result.successful) {
      logger.error(`[METADATA] Failed: ${result.stderr}`);
      throw new Error(`Failed to extract metadata: ${result.stderr}`);
    }
    const metadata = parseGdalInfo(result.stdout);
    if (!metadata?.cornerCoordinates) {
      throw new Error("Metadata does not contain cornerCoordinates");
    }
    return calculateBoundingBox(metadata.cornerCoordinates);
  }

  /** "EPSG:xxxx" (or the CRS name) of the GeoTIFF, or null. */
  async extractSrs(filePath: string): Promise<string | null> {
    const fileName = extractFileName(filePath);
    logger.info(`[METADATA] Extracting SRS from ${fileName}`);
    const result = await this.run("gdal", ["gdalinfo", "-json", `/data/geodata/geotiff/${fileName}`]);
    if (!result.successful) return null;
    const cs = parseGdalInfo(result.stdout)?.coordinateSystem;
    if (!cs) return null;
    if (cs.id?.authority && cs.id.code !== undefined && cs.id.code !== null) {
      return `${cs.id.authority}:${cs.id.code}`;
    }
    // The CRS's own ID closes the WKT; earlier IDs belong to nested elements (base CRS, units).
    const ids = cs.wkt ? [...cs.wkt.matchAll(/ID\["EPSG",(\d+)\]/gi)] : [];
    if (ids.length > 0) return `EPSG:${ids[ids.length - 1][1]}`;
    return cs.name ?? (cs.wkt ? cs.wkt.slice(0, 50) : null);
  }

  /** "rgba" when a band has a colour table (always RGBA for web tiles), otherwise null. */
  async getColorTableType(storagePath: string): Promise<string | null> {
    const inputName = extractFileName(storagePath);
    const result = await this.run("gdal", ["gdalinfo", "-json", `/data/geodata/geotiff/${inputName}`]);
    if (!result.successful) return null;
    const bands = parseGdalInfo(result.stdout)?.bands;
    if (Array.isArray(bands)) {
      for (const band of bands) {
        if (band?.colorTable !== undefined || band?.colorInterpretation?.toLowerCase() === "palette") return "rgba";
      }
    }
    return null;
  }

  private async ensureTilesetDirectory(baseDir: "terrain-tiles" | "xyz-tiles", tilesetId: string): Promise<void> {
    const fullPath = storage.path("public", `${baseDir}/${tilesetId}`);
    try {
      await fs.mkdir(fullPath, { recursive: true, mode: 0o775 });
    } catch {
      logger.error(`[DIRECTORY] Failed to create: ${fullPath}`);
      throw new Error(`Could not create output directory: ${fullPath}`);
    }
    logger.info(`[DIRECTORY] Verified: ${fullPath}`);
  }
}
