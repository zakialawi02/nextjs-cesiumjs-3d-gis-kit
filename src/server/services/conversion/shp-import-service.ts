import fs from "node:fs/promises";

import { storage } from "@/server/storage";
import type { GdalService } from "@/server/services/conversion/gdal-service";
import { extractShapefileArchive } from "@/server/services/upload/shapefile-archive";
import { randomString } from "@/server/services/support";

/**
 * Zipped shapefile → WGS84 GeoJSON (port of ShpImportService): safe extraction into a temporary
 * directory on the geodata disk, then ogr2ogr (CRS from the .prj).
 */
export class ShpImportService {
  constructor(private readonly gdal: GdalService) {}

  async process(zipPath: string, outputPath: string): Promise<true> {
    const extractPath = storage.path("geodata", `temp/shp_extract_${Date.now().toString(16)}${randomString(6)}`);
    try {
      const shpPath = await extractShapefileArchive(zipPath, extractPath);
      await this.gdal.reprojectToWgs84(shpPath, outputPath);
    } finally {
      await fs.rm(extractPath, { recursive: true, force: true });
    }
    return true;
  }
}
