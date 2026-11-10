import type { PoolClient } from "pg";

import { log } from "@/server/logger";
import { pgPool, VECTOR_SCHEMA, withPgTransaction } from "@/server/db/pg";

/**
 * One physical PostGIS table per vector layer (port of DynamicTableService), created in the
 * `geodata_vectors` schema as `vector_<lowercased layer id>`. Identifiers are generated here and
 * pattern-checked before any DDL; attribute columns are sanitized and quoted.
 */
export const VECTOR_TABLE_PATTERN = /^vector_[a-z0-9_]{1,60}$/;

/** Columns every vector table has; GeoJSON properties with these names get an `attr_` prefix. */
export const RESERVED_COLUMNS = ["id", "geometry", "created_at", "updated_at"];

export function isValidVectorTableName(tableName: string): boolean {
  return VECTOR_TABLE_PATTERN.test(tableName);
}

/** vector_<layer id> with "-" turned into "_" and lowercased. */
export function generateTableName(layerId: string): string {
  return `vector_${layerId.replace(/-/g, "_").toLowerCase()}`;
}

/** geodata_vectors."vector_x" for a validated table name. */
export function qualifiedVectorTable(tableName: string): string {
  if (!isValidVectorTableName(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return `${VECTOR_SCHEMA}."${tableName}"`;
}

/** Column name for a GeoJSON property key (same rule as the importer). */
export function columnNameForProperty(key: string): string {
  const safe = key.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  return RESERVED_COLUMNS.includes(safe) ? `attr_${safe}` : safe;
}

export async function vectorTableExists(tableName: string, client?: PoolClient): Promise<boolean> {
  const db = client ?? pgPool;
  const result = await db.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS exists",
    [VECTOR_SCHEMA, tableName],
  );
  return result.rows[0]?.exists === true;
}

/**
 * Creates the table for a vector layer (dropping a leftover one from an earlier attempt) and
 * returns its name.
 */
export async function createVectorTable(layerId: string, attributes: string[] = []): Promise<string> {
  const sanitizedId = layerId.replace(/-/g, "_").replace(/[^a-z0-9_]/gi, "").toLowerCase();
  if (!sanitizedId || sanitizedId.length > 63) {
    throw new Error(`Invalid layerId for table creation: ${layerId}`);
  }

  const tableName = generateTableName(sanitizedId);
  if (!isValidVectorTableName(tableName)) {
    throw new Error(`Generated table name failed validation: ${tableName}`);
  }

  const columns: string[] = [];
  if (attributes.length === 0) {
    columns.push('"properties" TEXT');
  } else {
    const seen = new Set<string>();
    for (const attribute of attributes) {
      let safe = attribute.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
      if (!safe || safe.length > 63) {
        log.warning(`DynamicTableService: Skipping invalid attribute: ${attribute}`);
        continue;
      }
      if (RESERVED_COLUMNS.includes(safe)) safe = `attr_${safe}`;
      // Keys that differ only by case or punctuation sanitize to the same column; keep one.
      if (seen.has(safe)) continue;
      seen.add(safe);
      columns.push(`"${safe}" TEXT`);
    }
  }

  const table = qualifiedVectorTable(tableName);
  const indexName = `idx_${tableName.slice(0, 50)}_geom`;

  await withPgTransaction(async (client) => {
    if (await vectorTableExists(tableName, client)) {
      log.warning(`DynamicTableService: Table ${tableName} already exists. Dropping for fresh import.`);
      await client.query(`DROP TABLE IF EXISTS ${table}`);
    }
    await client.query(`CREATE TABLE ${table} (
            id BIGSERIAL PRIMARY KEY,
            geometry geometry(GeometryZ, 4326),
            ${columns.map((column) => `${column},`).join("\n            ")}
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
    await client.query(`CREATE INDEX "${indexName}" ON ${table} USING GIST (geometry)`);
  });

  log.info(`DynamicTableService: Created physical table ${tableName}`);
  return tableName;
}

/** Drops a vector table; refuses names that do not match the vector_* pattern. */
export async function dropVectorTable(tableName: string | null | undefined): Promise<boolean> {
  if (!tableName) return false;
  if (!isValidVectorTableName(tableName)) {
    log.warning(`DynamicTableService: Refused to drop table with invalid name: ${tableName}`);
    return false;
  }
  await pgPool.query(`DROP TABLE IF EXISTS ${qualifiedVectorTable(tableName)}`);
  log.info(`DynamicTableService: Dropped physical table ${tableName}`);
  return true;
}
