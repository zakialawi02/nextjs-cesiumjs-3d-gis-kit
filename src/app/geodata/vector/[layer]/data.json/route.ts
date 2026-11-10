import QueryStream from "pg-query-stream";

import { LayerStatus } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth";
import { pgPool, VECTOR_SCHEMA } from "@/server/db/pg";
import { abortUnless, handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

const TABLE_NAME_PATTERN = /^vector_[a-z0-9_]{1,60}$/;

/** Columns that are not feature properties. */
const SKIPPED_COLUMNS = new Set(["id", "geometry", "geometry_json", "created_at", "updated_at"]);

/** Rows per chunk written to the response. */
const ROWS_PER_CHUNK = 250;

type VectorRow = Record<string, unknown> & { id?: unknown; geometry_json?: string | null };

/** One GeoJSON Feature; the geometry JSON from ST_AsGeoJSON is spliced in without re-parsing. */
function featureJson(row: VectorRow): string {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SKIPPED_COLUMNS.has(key)) continue;
    properties[key.startsWith("attr_") ? key.slice(5) : key] = value;
  }

  // BIGSERIAL ids arrive as strings from node-postgres; Laravel emitted them as JSON numbers.
  const id =
    typeof row.id === "string" && /^-?\d+$/.test(row.id) ? row.id : JSON.stringify(row.id ?? null);
  const geometry =
    typeof row.geometry_json === "string" && row.geometry_json !== "" ? row.geometry_json : "null";

  return `{"type":"Feature","id":${id},"geometry":${geometry},"properties":${JSON.stringify(properties)}}`;
}

/**
 * GET /geodata/vector/{layer}/data.json (GeodataLayerController::getVectorGeoJson): streams the
 * layer's PostGIS table (geodata_vectors.vector_<id>) as a GeoJSON FeatureCollection.
 */
export const GET = handler<{ layer: string }>(async (_request, { params }) => {
  await requireApiUser();
  const { layer: layerId } = await params;

  const layer = await prisma.layer.findUnique({
    where: { id: layerId },
    select: { status: true, vector_detail: { select: { physical_table_name: true } } },
  });
  abortUnless(layer, 404);
  abortUnless(layer.status === LayerStatus.Published, 404);

  const tableName = layer.vector_detail?.physical_table_name;
  if (!tableName) {
    return json({ type: "FeatureCollection", features: [] });
  }

  abortUnless(TABLE_NAME_PATTERN.test(tableName), 400, "Invalid table name pattern.");

  const client = await pgPool.connect();
  let released = false;
  const release = (destroy = false) => {
    if (released) return;
    released = true;
    // A connection with an unfinished cursor must not go back to the pool.
    client.release(destroy ? true : undefined);
  };

  const rows = client.query(
    new QueryStream(
      `SELECT *, ST_AsGeoJSON(geometry) AS geometry_json FROM "${VECTOR_SCHEMA}"."${tableName}"`,
      [],
      {
        batchSize: 500,
      },
    ),
  );
  const iterator = rows[Symbol.asyncIterator]() as AsyncIterator<VectorRow>;

  // Read the first row before answering, so a missing table or bad SQL is a JSON 500, not a broken stream.
  let first: IteratorResult<VectorRow>;
  try {
    first = await iterator.next();
  } catch (error) {
    rows.destroy();
    release(true);
    throw error;
  }

  const encoder = new TextEncoder();
  let pending: IteratorResult<VectorRow> | null = first;
  let isFirstFeature = true;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"FeatureCollection","features":['));
    },
    async pull(controller) {
      try {
        let chunk = "";
        for (let count = 0; count < ROWS_PER_CHUNK; count++) {
          const result: IteratorResult<VectorRow> = pending ?? (await iterator.next());
          pending = null;
          if (result.done) {
            controller.enqueue(encoder.encode(`${chunk}]}`));
            controller.close();
            release();
            return;
          }
          chunk += (isFirstFeature ? "" : ",") + featureJson(result.value);
          isFirstFeature = false;
        }
        controller.enqueue(encoder.encode(chunk));
      } catch (error) {
        rows.destroy();
        release(true);
        controller.error(error);
      }
    },
    cancel() {
      // Client went away (layer toggled off, page closed): stop reading and drop the connection.
      rows.destroy();
      release(true);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
  });
});
