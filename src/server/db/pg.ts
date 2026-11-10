import { Pool, type PoolClient } from "pg";

import { env } from "@/env";

const globalForPg = globalThis as typeof globalThis & { pgPool?: Pool };

/**
 * Raw node-postgres pool for the spatial work Prisma cannot express: DDL of the dynamic
 * `geodata_vectors.vector_<layer id>` tables, bulk feature inserts and streaming GeoJSON
 * (pg-query-stream). Regular models go through Prisma (`@/lib/prisma`).
 */
export const pgPool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 10),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pgPool;
}

/** Postgres schema that holds the per-layer vector tables. */
export const VECTOR_SCHEMA = "geodata_vectors";

/** Runs `callback` inside a transaction on a dedicated client. */
export async function withPgTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
