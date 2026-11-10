import fs from "node:fs/promises";
import path from "node:path";

import { Prisma, type ConversionJob, type VectorDetail } from "@prisma/client";

import { JobStatus, LayerStatus } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { BaseConversionJob } from "@/server/jobs/base-conversion-job";
import type { JobRunContext } from "@/server/jobs/types";
import type { LogChannel } from "@/server/logger";
import { storage } from "@/server/storage";
import { DwgImportService } from "@/server/services/conversion/dwg-import-service";
import { injectDxfColors } from "@/server/services/conversion/dxf-color-injector";
import { GdalService } from "@/server/services/conversion/gdal-service";
import { ShpImportService } from "@/server/services/conversion/shp-import-service";
import { writeStrGeoJson } from "@/server/services/conversion/surpac-str-parser-service";
import { createVectorTable } from "@/server/services/database/dynamic-table-service";
import { getPropertiesSchema, importGeoJson, type ImportSummary } from "@/server/services/database/spatial-import-service";
import { dateOnly, errorMessage } from "@/server/services/support";

/**
 * GeoJSON / zipped Shapefile / DXF / DWG / Surpac STR → WGS84 GeoJSON → one PostGIS table per
 * layer (port of ProcessVectorLayer). Runs inside the AssembleGeodataUpload reservation.
 */
export class ProcessVectorLayer extends BaseConversionJob {
  protected vectorDetail: VectorDetail | null = null;

  constructor(
    conversionJob: ConversionJob,
    layerName: string,
    protected readonly sourceEpsg: string | null = null,
    acquisitionDate: string | null = null,
    context?: JobRunContext,
  ) {
    super(conversionJob, layerName, acquisitionDate, context);
  }

  protected getLogChannel(): LogChannel {
    return "vector_conversion";
  }

  protected getTotalSteps(): number {
    return 7;
  }

  async handle(gdal = new GdalService()): Promise<void> {
    gdal.setJobId(this.conversionJob.id).setSignal(this.signal);

    try {
      await this.initializePipeline();
      const wgs84GeojsonPath = await this.createDatabaseRecords();
      await this.convertToWgs84GeoJson(gdal, wgs84GeojsonPath);
      await this.injectDxfColors(wgs84GeojsonPath);
      const attributes = await this.scanGeoJsonSchema(wgs84GeojsonPath);
      const tableName = await this.createDynamicTable(attributes);
      const summary = await this.importToPhysicalTable(wgs84GeojsonPath, tableName);
      await this.updateVectorDetail(summary, tableName);
      await this.finalizeJob(wgs84GeojsonPath);
    } catch (error) {
      await this.handleFailure(error);
      throw error;
    }
  }

  private get layerId(): string {
    return this.layer!.id;
  }

  private async initializePipeline(): Promise<void> {
    await this.updateConversionJob({ status: JobStatus.Processing, conversion_tool: "gdal/ogr2ogr", started_at: new Date() });
    this.logEntry = await prisma.conversionLog.create({
      data: { job_id: this.conversionJob.id, attempt: this.attempts(), started_at: new Date() },
    });
    this.sourceFile = await prisma.sourceFile.findUniqueOrThrow({ where: { id: this.conversionJob.source_file_id } });
    this.logger.info(
      `Starting vector pipeline for Job #${this.conversionJob.id} (File: ${this.sourceFile.original_name} - ID: ${this.sourceFile.id})`,
    );
  }

  private async createDatabaseRecords(): Promise<string> {
    this.logStep(1, "Retrieving layer and creating vector detail records...");

    this.layer = await prisma.layer.findUnique({ where: { job_id: this.conversionJob.id } });
    if (!this.layer) {
      throw new Error(`Layer record not found for Job #${this.conversionJob.id}`);
    }

    const detail = {
      source_file_id: this.sourceFile!.id,
      source_format: this.sourceFile!.file_type,
      source_epsg: this.sourceEpsg,
      acquisition_date: dateOnly(this.acquisitionDate),
      srs: "EPSG:4326",
    };
    this.vectorDetail = await prisma.vectorDetail.upsert({
      where: { layer_id: this.layer.id },
      create: { layer_id: this.layer.id, ...detail },
      update: detail,
    });
    this.logStepSuccess(1, "Database Records");

    const wgs84GeojsonPath = storage.path("geodata", `geojson/vector_${this.layer.id}.geojson`);
    await fs.mkdir(path.dirname(wgs84GeojsonPath), { recursive: true });
    return wgs84GeojsonPath;
  }

  private async convertToWgs84GeoJson(gdal: GdalService, wgs84GeojsonPath: string): Promise<void> {
    this.logStep(2, "Converting source file to WGS84 GeoJSON...");
    const inputPath = storage.path("geodata", this.sourceFile!.storage_path);
    const fileType = this.sourceFile!.file_type;

    // ogr2ogr will not overwrite an output left by an earlier attempt.
    await fs.rm(wgs84GeojsonPath, { force: true });

    if (fileType === "str") {
      const intermediatePath = storage.path("geodata", `geojson/str_int_${this.layerId}.geojson`);
      try {
        await writeStrGeoJson(inputPath, intermediatePath);
        await gdal.reprojectToWgs84(intermediatePath, wgs84GeojsonPath, this.sourceEpsg);
      } finally {
        await fs.rm(intermediatePath, { force: true });
      }
    } else if (fileType === "dwg" || fileType === "dxf") {
      await new DwgImportService(gdal).process(inputPath, wgs84GeojsonPath, this.sourceEpsg);
    } else if (fileType === "shapefile") {
      await new ShpImportService(gdal).process(inputPath, wgs84GeojsonPath);
    } else {
      await gdal.reprojectToWgs84(inputPath, wgs84GeojsonPath, this.sourceEpsg);
    }

    this.logStepSuccess(2, "WGS84 Conversion");
  }

  /** DXF only: ogr2ogr drops entity colours, so they are read from the original file. */
  private async injectDxfColors(wgs84GeojsonPath: string): Promise<void> {
    const fileType = this.sourceFile!.file_type;
    if (fileType !== "dxf" && fileType !== "dwg") return;
    if (fileType !== "dxf") {
      this.logger.info("Skipping DXF color injection for DWG file (binary format).");
      return;
    }

    this.logStepExtra("Injecting DXF entity colors into GeoJSON...");
    try {
      const injected = await injectDxfColors(storage.path("geodata", this.sourceFile!.storage_path), wgs84GeojsonPath);
      this.logStepExtra(
        injected ? "DXF color injection completed successfully." : "DXF color injection skipped (no colors found or not applicable).",
      );
    } catch (error) {
      // Non-critical: the layer is imported without colours.
      this.logger.warning(`DXF color injection failed (non-critical): ${errorMessage(error)}`);
      this.logStepExtra(`DXF color injection FAILED (non-critical): ${errorMessage(error)}`);
    }
  }

  private async scanGeoJsonSchema(wgs84GeojsonPath: string): Promise<string[]> {
    this.logStep(3, "Scanning GeoJSON for properties schema...");
    const attributes = await getPropertiesSchema(wgs84GeojsonPath);
    this.logStepSuccess(3, "Schema Scanned", `Found ${attributes.length} attributes`);
    return attributes;
  }

  private async createDynamicTable(attributes: string[]): Promise<string> {
    this.logStep(4, "Creating dynamic physical PostGIS table with dedicated columns...");
    const tableName = await createVectorTable(this.layerId, attributes);
    this.logStepSuccess(4, "Dynamic Table Created", `Table: ${tableName}`);
    return tableName;
  }

  private async importToPhysicalTable(wgs84GeojsonPath: string, tableName: string): Promise<ImportSummary> {
    this.logStep(5, "Importing features into physical table...");
    const summary = await importGeoJson(wgs84GeojsonPath, tableName);
    this.logStepSuccess(5, "Import Completed", `Features: ${summary.feature_count}`);
    return summary;
  }

  private async updateVectorDetail(summary: ImportSummary, tableName: string): Promise<void> {
    this.logStep(6, "Updating vector detail with spatial summary...");
    this.vectorDetail = await prisma.vectorDetail.update({
      where: { id: this.vectorDetail!.id },
      data: {
        feature_count: summary.feature_count,
        geometry_type: summary.geometry_type.slice(0, 30),
        native_bounding_box: summary.bbox ?? Prisma.DbNull,
        physical_table_name: tableName,
        output_path: `geodata/geojson/vector_${this.layerId}.geojson`,
      },
    });
    this.logStepSuccess(6, "Spatial Update");
  }

  private async finalizeJob(wgs84GeojsonPath: string): Promise<void> {
    this.logStep(7, "Finalizing job...");

    let outputSize = 0;
    try {
      outputSize = (await fs.stat(wgs84GeojsonPath)).size;
      // The converted GeoJSON is kept next to the source.
      this.logger.info(`Preserving GeoJSON vector output at: ${wgs84GeojsonPath} (Size: ${outputSize} bytes)`);
    } catch {
      outputSize = 0;
    }

    const sourcePath = this.sourceFile!.storage_path;
    if (await storage.exists("geodata", sourcePath)) {
      const currentSize = await storage.size("geodata", sourcePath);
      this.sourceFile = await prisma.sourceFile.update({ where: { id: this.sourceFile!.id }, data: { file_size: currentSize } });
      this.logger.info(`SourceFile #${this.sourceFile.id} size updated/recalculated to: ${currentSize} bytes`);
    }

    this.layer = await prisma.layer.update({
      where: { id: this.layerId },
      data: { status: LayerStatus.Published, published_at: new Date() },
    });
    await this.updateConversionJob({ status: JobStatus.Done, finished_at: new Date() });

    if (this.logEntry) {
      this.logEntry = await prisma.conversionLog.update({
        where: { id: this.logEntry.id },
        data: { finished_at: new Date(), exit_code: 0, output_size: outputSize },
      });
    }

    this.logStepSuccess(7, "Finalization");
    this.logger.info(`Finished vector pipeline successfully for Job #${this.conversionJob.id}`);
  }
}
