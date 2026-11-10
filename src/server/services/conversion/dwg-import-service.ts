import type { GdalService } from "@/server/services/conversion/gdal-service";

/**
 * DWG / DXF → WGS84 GeoJSON (port of DwgImportService). CAD files rarely carry a CRS, so the source
 * EPSG is required; ogr2ogr runs with `-dim 3` to keep elevations.
 */
export class DwgImportService {
  constructor(private readonly gdal: GdalService) {}

  async process(inputPath: string, outputPath: string, sourceEpsg: string | null): Promise<true> {
    await this.gdal.reprojectToWgs84(inputPath, outputPath, sourceEpsg);
    return true;
  }
}
