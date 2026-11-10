import type { PoolClient } from "pg";

import { pgPool, VECTOR_SCHEMA } from "@/server/db/pg";
import {
  columnNameForProperty,
  isValidVectorTableName,
  qualifiedVectorTable,
} from "@/server/services/database/dynamic-table-service";
import { readGeoJsonFeatures } from "@/server/services/upload/geojson-feature-reader";

/**
 * Bulk import of a WGS84 GeoJSON file into a layer's vector table (port of SpatialImportService).
 * Feature values and geometries are bound parameters; rows are inserted in batches.
 */
export type BoundingBox = { west: number; south: number; east: number; north: number };

export type ImportSummary = {
  feature_count: number;
  geometry_type: string;
  bbox: BoundingBox | null;
};

const MAX_BATCH_ROWS = 500;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
/** PostgreSQL accepts at most 65535 bind parameters per statement. */
const MAX_BIND_PARAMETERS = 65535;
const MAX_ATTRIBUTES = 256;

function assertValidTableName(tableName: string): void {
  if (!isValidVectorTableName(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
}

/** Every distinct property key of the dataset, in first-seen order. */
export async function getPropertiesSchema(geojsonPath: string): Promise<string[]> {
  const keys = new Set<string>();
  for await (const feature of readGeoJsonFeatures(geojsonPath)) {
    const properties = feature.properties;
    if (properties && typeof properties === "object") {
      for (const key of Object.keys(properties)) {
        keys.add(key);
        if (keys.size > MAX_ATTRIBUTES) {
          throw new Error("Vector dataset exceeds the 256 attribute limit.");
        }
      }
    }
  }
  return [...keys];
}

/**
 * Parses ST_AsText(ST_Extent(...)): POLYGON((minX minY, minX maxY, maxX maxY, maxX minY, minX minY)).
 * A flat extent comes back as LINESTRING(minX minY, maxX maxY); a single point gives null.
 */
export function parsePostGisExtent(extent: string | null | undefined): BoundingBox | null {
  if (!extent) return null;
  const coords = (extent.match(/-?\d+\.?\d*(?:e[-+]?\d+)?/gi) ?? []).map((value) => Number.parseFloat(value));
  if (coords.length >= 6) {
    return { west: coords[0], south: coords[1], east: coords[4], north: coords[5] };
  }
  if (coords.length >= 4) {
    return { west: coords[0], south: coords[1], east: coords[2], north: coords[3] };
  }
  return null;
}

/** Text value for a TEXT attribute column. */
function columnValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

async function tableColumns(client: PoolClient, tableName: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [VECTOR_SCHEMA, tableName],
  );
  return result.rows.map((row) => row.column_name);
}

export async function importGeoJson(geojsonPath: string, tableName: string): Promise<ImportSummary> {
  assertValidTableName(tableName);
  const table = qualifiedVectorTable(tableName);

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");

    const attributeColumns = (await tableColumns(client, tableName)).filter(
      (column) => !["id", "geometry", "created_at", "updated_at"].includes(column),
    );
    const attributeSet = new Set(attributeColumns);
    const insertColumns = ["geometry", ...attributeColumns, "created_at", "updated_at"];
    const parametersPerRow = insertColumns.length;
    const rowsPerBatch = Math.max(1, Math.min(MAX_BATCH_ROWS, Math.floor(MAX_BIND_PARAMETERS / parametersPerRow)));
    const columnList = insertColumns.map((column) => `"${column}"`).join(", ");

    let count = 0;
    let geometryType = "Mixed";
    let batch: Array<Array<string | null>> = [];
    let batchBytes = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      const values: Array<string | null> = [];
      const tuples = batch.map((row) => {
        const placeholders = row.map((value, index) => {
          values.push(value);
          const parameter = `$${values.length}`;
          return index === 0 ? `ST_Force3DZ(ST_SetSRID(ST_GeomFromGeoJSON(${parameter}), 4326))` : parameter;
        });
        return `(${placeholders.join(", ")})`;
      });
      await client.query(`INSERT INTO ${table} (${columnList}) VALUES ${tuples.join(", ")}`, values);
      batch = [];
      batchBytes = 0;
    };

    for await (const feature of readGeoJsonFeatures(geojsonPath)) {
      if (count === 0) {
        const type = feature.geometry?.type;
        geometryType = typeof type === "string" ? type : "Unknown";
      }
      count++;

      const now = new Date().toISOString().replace("T", " ").replace("Z", "");
      const attributes = new Map<string, string | null>();
      const properties = feature.properties;
      if (properties && typeof properties === "object") {
        for (const [key, value] of Object.entries(properties)) {
          const column = columnNameForProperty(key);
          if (attributeSet.has(column)) attributes.set(column, columnValue(value));
        }
      }

      const geometry = feature.geometry === null ? null : JSON.stringify(feature.geometry);
      const row: Array<string | null> = [geometry, ...attributeColumns.map((column) => attributes.get(column) ?? null), now, now];
      batch.push(row);
      for (const value of row) batchBytes += value === null ? 4 : value.length;

      if (batch.length >= rowsPerBatch || batchBytes >= MAX_BATCH_BYTES) await flush();
    }
    await flush();

    const extent = await client.query<{ extent: string | null }>(`SELECT ST_AsText(ST_Extent(geometry)) AS extent FROM ${table}`);
    await client.query("COMMIT");

    return {
      feature_count: count,
      geometry_type: geometryType,
      bbox: parsePostGisExtent(extent.rows[0]?.extent ?? null),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
