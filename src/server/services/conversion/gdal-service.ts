import { existsSync } from "node:fs";
import path from "node:path";

import { log } from "@/server/logger";
import { runDockerCompose } from "@/server/services/conversion/docker";

/**
 * ogr2ogr wrapper (port of GdalService): any vector format → WGS84 GeoJSON, inside the `gdal`
 * converter container. The input directory is mounted read-only at /data/input and the output
 * directory at /data/output.
 */
export class GdalService {
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

  /**
   * @param inputPath absolute host path of the input file
   * @param outputPath absolute host path of the .geojson to write
   * @param sourceEpsg source CRS (e.g. "EPSG:23836") for formats without one
   */
  async reprojectToWgs84(inputPath: string, outputPath: string, sourceEpsg?: string | null): Promise<true> {
    const dockerInputPath = `/data/input/${path.basename(inputPath)}`;
    const dockerOutputPath = `/data/output/${path.basename(outputPath)}`;

    const ogrArgs = ["ogr2ogr", "--config", "SHAPE_RESTORE_SHX", "YES", "-f", "GeoJSON"];
    if (sourceEpsg) ogrArgs.push("-s_srs", sourceEpsg);
    ogrArgs.push(
      "-t_srs",
      "EPSG:4326",
      "-dim",
      "3",
      "-lco",
      "COORDINATE_PRECISION=8",
      "-lco",
      "WRITE_BBOX=YES",
      dockerOutputPath,
      dockerInputPath,
    );

    log.info("Executing GDAL Reprojection via Process Facade", {
      source_epsg: sourceEpsg ?? null,
      input: inputPath,
      output: outputPath,
    });

    // SHAPE_RESTORE_SHX rewrites the .shx next to the .shp (GDAL 3.13 does so even for a valid
    // one), so a shapefile's own temporary extraction directory is mounted writable.
    const inputMount = path.extname(inputPath).toLowerCase() === ".shp" ? "" : ":ro";
    const result = await runDockerCompose("gdal", ogrArgs, {
      jobId: this.jobId,
      runOptions: ["-v", `${path.dirname(inputPath)}:/data/input${inputMount}`, "-v", `${path.dirname(outputPath)}:/data/output`],
      signal: this.signal,
    });

    if (!result.successful) {
      const errorOutput = result.stderr;
      log.error(`GDAL conversion failed: ${errorOutput}`);
      if (errorOutput.includes("libopencad") && errorOutput.includes("does not support this version")) {
        throw new Error(
          "This version of the DWG format is not supported by GDAL. Please save your DWG file as an AutoCAD 2000 file, or use the DXF format.",
        );
      }
      throw new Error(`GDAL conversion failed. Output: ${errorOutput}`);
    }

    if (!existsSync(outputPath)) {
      throw new Error(`GDAL reported success but output file not found at: ${outputPath}`);
    }

    log.info(`GDAL conversion successful: ${outputPath}`);
    return true;
  }
}
