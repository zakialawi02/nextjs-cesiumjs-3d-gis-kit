import fs from "node:fs/promises";
import path from "node:path";

import type { Prisma, TerrainDetail } from "@prisma/client";

import { JobStatus, LayerStatus, LayerType, SourceFileStatus, TerrainOutputType } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { BaseConversionJob } from "@/server/jobs/base-conversion-job";
import type { LogChannel } from "@/server/logger";
import { storage } from "@/server/storage";
import {
  ORTHO_MAX_ZOOM,
  ORTHO_MIN_ZOOM,
  TerrainConversionService,
  type BoundingBox,
} from "@/server/services/conversion/terrain-conversion-service";
import { dateOnly } from "@/server/services/support";

/**
 * GeoTIFF DEM (+ optional orthophoto) → quantized-mesh terrain tiles and XYZ ortho tiles (port of
 * ProcessGeotiffTerrain). Runs inside the AssembleGeodataUpload reservation.
 */
const CONVERSION_TOOLS: Record<string, string> = {
  [LayerType.Terrain]: "ctb/gdal2tiles",
  [LayerType.Imagery]: "gdal-imagery",
  [LayerType.Vector]: "gdal/ogr2ogr",
};

async function directorySize(directory: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true, recursive: true });
  } catch {
    return 0;
  }
  let size = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      size += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
    } catch {
      // Removed while counting.
    }
  }
  return size;
}

export class ProcessGeotiffTerrain extends BaseConversionJob {
  protected terrainDetail: TerrainDetail | null = null;

  protected getLogChannel(): LogChannel {
    return "terrain_conversion";
  }

  protected getTotalSteps(): number {
    return this.conversionJob.ortho_file_id !== null ? 7 : 6;
  }

  async handle(service = new TerrainConversionService()): Promise<void> {
    service.setJobId(this.conversionJob.id).setSignal(this.signal);

    try {
      await this.initializePipeline();

      this.logStep(1, "Validating GeoTIFF header...");
      if (!(await service.validate(this.sourceFile!))) {
        throw new Error("Invalid GeoTIFF file header/format.");
      }
      this.logStepSuccess(1, "Validation");

      const wgs84Path = await this.reprojectToWgs84(service);
      await this.processTerrainTiles(service, wgs84Path);
      await this.generateLayerMetadata(service, wgs84Path);
      const bbox = await this.extractBoundingBox(service, wgs84Path);

      await this.processOrthophoto(service);
      await this.generateOrthoXYZTiles(service);

      await this.finalizeJob(bbox);
      await this.cleanupTemporaryFile(wgs84Path);
      await this.completePipeline();
    } catch (error) {
      await this.handleFailure(error);
      throw error;
    }
  }

  private async updateTerrainDetail(data: Prisma.TerrainDetailUpdateInput): Promise<TerrainDetail> {
    this.terrainDetail = await prisma.terrainDetail.update({ where: { id: this.terrainDetail!.id }, data });
    return this.terrainDetail;
  }

  private async initializePipeline(): Promise<void> {
    await this.updateConversionJob({
      status: JobStatus.Processing,
      conversion_tool: CONVERSION_TOOLS[this.conversionJob.layer_type] ?? null,
      started_at: new Date(),
    });

    this.sourceFile = await prisma.sourceFile.findUniqueOrThrow({ where: { id: this.conversionJob.source_file_id } });
    if (this.sourceFile.status !== SourceFileStatus.Ready) {
      throw new Error(`Source file is not ready for conversion (status: ${this.sourceFile.status})`);
    }

    this.layer = await prisma.layer.findUnique({ where: { job_id: this.conversionJob.id } });
    if (!this.layer) {
      throw new Error(`Layer record not found for Job #${this.conversionJob.id}`);
    }

    const detail = {
      source_file_id: this.sourceFile.id,
      ortho_file_id: this.conversionJob.ortho_file_id,
      has_ortho: this.conversionJob.ortho_file_id !== null,
      output_type: TerrainOutputType.Terrain,
      acquisition_date: dateOnly(this.acquisitionDate),
    };
    this.terrainDetail = await prisma.terrainDetail.upsert({
      where: { layer_id: this.layer.id },
      create: { layer_id: this.layer.id, ...detail },
      update: detail,
    });

    this.logEntry = await prisma.conversionLog.create({
      data: { job_id: this.conversionJob.id, attempt: this.attempts(), started_at: new Date() },
    });

    this.logger.info(
      `Starting pipeline for Job #${this.conversionJob.id} (File: ${this.sourceFile.original_name} - ID: ${this.sourceFile.id})`,
    );
  }

  private async reprojectToWgs84(service: TerrainConversionService): Promise<string> {
    this.logStep(2, "Reprojecting to EPSG:4326 (WGS84)...");
    const originalSrs = await service.extractSrs(this.sourceFile!.storage_path);
    await this.updateTerrainDetail({ srs: originalSrs?.slice(0, 50) ?? null });
    const wgs84Path = await service.reproject(this.sourceFile!);
    this.logStepSuccess(2, "Reprojection", `Path: ${wgs84Path}`);
    return wgs84Path;
  }

  private async processTerrainTiles(service: TerrainConversionService, wgs84Path: string): Promise<void> {
    this.logStep(3, "Generating quantized-mesh terrain tiles...");
    await service.generateTerrain(wgs84Path, this.layer!.id);
    this.logStepSuccess(3, "Tiling");
  }

  private async generateLayerMetadata(service: TerrainConversionService, wgs84Path: string): Promise<void> {
    this.logStep(4, "Generating layer.json metadata...");
    await service.generateLayerJson(wgs84Path, this.layer!.id);
    this.logStepSuccess(4, "layer.json");
  }

  private async extractBoundingBox(service: TerrainConversionService, wgs84Path: string): Promise<BoundingBox> {
    this.logStep(5, "Extracting bounding box for Cesium camera...");
    return service.extractBoundingBox(wgs84Path);
  }

  private async processOrthophoto(service: TerrainConversionService): Promise<void> {
    if (!this.terrainDetail?.has_ortho || !this.conversionJob.ortho_file_id) return;
    const orthoFile = await prisma.sourceFile.findUnique({ where: { id: this.conversionJob.ortho_file_id } });
    if (!orthoFile) return;

    this.logStepExtra("Reprojecting Orthophoto...");
    this.layer = await prisma.layer.update({ where: { id: this.layer!.id }, data: { status: LayerStatus.Processing } });

    const originalPath = orthoFile.storage_path;
    const orthoWgs84 = await service.reproject(orthoFile);
    if (originalPath && originalPath !== orthoWgs84) {
      await storage.delete("geodata", originalPath);
      this.logger.info(`[STEP EXTRA] Deleted original ortho file: ${originalPath}`);
    }

    const newSize = (await storage.exists("geodata", orthoWgs84)) ? await storage.size("geodata", orthoWgs84) : Number(orthoFile.file_size);
    await prisma.sourceFile.update({
      where: { id: orthoFile.id },
      data: { storage_path: orthoWgs84, stored_name: path.posix.basename(orthoWgs84), file_size: newSize },
    });

    this.logStepSuccess(-1, "Orthophoto Reprojection", `Layer: ${this.layerName} (Ortho size: ${newSize} bytes)`);
  }

  private async generateOrthoXYZTiles(service: TerrainConversionService): Promise<void> {
    if (!this.terrainDetail?.has_ortho) return;
    this.logStep(6, "Generating XYZ tiles from orthophoto...");
    try {
      const orthoFile = this.conversionJob.ortho_file_id
        ? await prisma.sourceFile.findUnique({ where: { id: this.conversionJob.ortho_file_id } })
        : null;
      if (!orthoFile) {
        throw new Error("Ortho file not found or invalid for XYZ tiles generation.");
      }
      const orthoTilesPath = await service.generateOrthoTiles(orthoFile.storage_path, this.layer!.id);
      await this.updateTerrainDetail({ ortho_tiles_path: orthoTilesPath, ortho_min_zoom: ORTHO_MIN_ZOOM, ortho_max_zoom: ORTHO_MAX_ZOOM });
      this.logStepSuccess(6, "XYZ Tiles Generation", `Path: ${orthoTilesPath}`);
    } catch (error) {
      this.logger.error(`XYZ tiles generation failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async finalizeJob(bbox: BoundingBox): Promise<void> {
    const step = this.terrainDetail?.has_ortho ? 7 : 6;
    this.logStep(step, "Finalizing job records...");

    await this.updateConversionJob({ status: JobStatus.Done, finished_at: new Date() });

    const layerId = this.layer!.id;
    await this.updateTerrainDetail({
      native_bounding_box: bbox,
      tileset_path: `terrain-tiles/${layerId}`,
      // Same-origin URL of the authenticated terrain endpoint.
      tileset_url: `/geodata/terrain/${layerId}`,
    });

    this.layer = await prisma.layer.update({
      where: { id: layerId },
      data: { status: LayerStatus.Published, published_at: this.layer!.published_at ?? new Date() },
    });

    this.logStepSuccess(step, "Finalization");
  }

  private async completePipeline(): Promise<void> {
    if (this.logEntry) {
      this.logEntry = await prisma.conversionLog.update({
        where: { id: this.logEntry.id },
        data: {
          finished_at: new Date(),
          exit_code: 0,
          output_size: await directorySize(storage.path("public", `terrain-tiles/${this.layer!.id}`)),
        },
      });
    }
    this.logger.info(`Finished pipeline successfully for Job #${this.conversionJob.id}`);
  }

  private async cleanupTemporaryFile(wgs84Path: string): Promise<void> {
    const source = this.sourceFile!;
    const originalPath = source.storage_path;
    if (originalPath && originalPath !== wgs84Path && (await storage.exists("geodata", originalPath))) {
      await storage.delete("geodata", originalPath);
      this.logger.info(`Deleted original source DEM file: ${originalPath}`);
    }

    const newSize = (await storage.exists("geodata", wgs84Path)) ? await storage.size("geodata", wgs84Path) : Number(source.file_size);
    this.sourceFile = await prisma.sourceFile.update({
      where: { id: source.id },
      data: { storage_path: wgs84Path, stored_name: path.posix.basename(wgs84Path), file_size: newSize },
    });

    this.logger.info(
      `[STEP INFO] Deleted temp file (SourceFile ${source.id}) used for WGS84 version: ${wgs84Path} (New size: ${newSize} bytes)`,
    );
  }
}
