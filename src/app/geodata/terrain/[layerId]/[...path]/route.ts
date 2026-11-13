import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { requireApiUser } from "@/server/auth";
import { abort, handler, HttpError } from "@/server/http";
import { storage } from "@/server/storage";

import { abortUnlessPublished, isMissingFileError } from "@/server/geodata/published-layer";
import { verifyTerrainToken, withTerrainToken } from "@/server/geodata/terrain-url";

export const dynamic = "force-dynamic";

const gunzipAsync = promisify(gunzip);

/**
 * Bumped when tiles are regenerated in place or their encoding changes, so browsers drop cached
 * copies (3: tiles are now sent decompressed, see serveTerrainTile).
 */
const TERRAIN_TILE_REVISION = "3";

const LAYER_ID_PATTERN = /^[0-9A-Za-z]{26}$/;
const TILE_PATTERN = /^([0-9]{1,2})\/([0-9]{1,9})\/([0-9]{1,9})\.terrain$/;

/**
 * GET /geodata/terrain/{layerId}/layer.json and /geodata/terrain/{layerId}/{z}/{x}/{y}.terrain
 * (GeodataLayerController::serveTerrainMetadata / serveTerrainTile). Files come from
 * storage/app/public/terrain-tiles/<layerId>, only for published layers.
 *
 * Authenticated by the session cookie or a Bearer token, or by a signed `t` parameter from
 * GET /api/mobile/layers/{layerId}/terrain-url (clients that cannot send headers with tile
 * requests). When `t` is present it is the only credential checked.
 */
export const GET = handler<{ layerId: string; path: string[] }>(async (request, { params }) => {
  const { layerId, path } = await params;
  const rest = path.join("/");
  const tile = TILE_PATTERN.exec(rest);
  if (!LAYER_ID_PATTERN.test(layerId) || (rest !== "layer.json" && !tile)) abort(404);

  const signed = request.nextUrl.searchParams.get("t");
  if (signed !== null) {
    if (!(await verifyTerrainToken(layerId, signed))) throw new HttpError(401);
  } else {
    await requireApiUser();
  }

  return tile
    ? serveTerrainTile(layerId, tile[1], tile[2], tile[3])
    : serveTerrainMetadata(layerId, signed);
});

/**
 * A quantized-mesh tile. ctb-tile writes gzip-compressed tiles; Laravel sent them as-is with
 * `Content-Encoding: gzip`, but Next.js drops Content-Encoding (and Content-Length) from route
 * handler responses, so the browser would receive raw gzip bytes. Decompress here instead;
 * Next's own compression skips application/octet-stream, so let the reverse proxy gzip tiles
 * (deploy/nginx/gis-kit.conf). `private`: tiles require a session, shared caches must not keep them.
 */
async function serveTerrainTile(
  layerId: string,
  z: string,
  x: string,
  y: string,
): Promise<Response> {
  await abortUnlessPublished(layerId);

  let file: Buffer;
  try {
    file = await storage.read("public", `terrain-tiles/${layerId}/${z}/${x}/${y}.terrain`);
  } catch (error) {
    if (isMissingFileError(error)) {
      return new Response("Terrain tile not found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    throw error;
  }

  const body = file.length >= 2 && file[0] === 0x1f && file[1] === 0x8b ? await gunzipAsync(file) : file;

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=604800",
      "Content-Type": "application/octet-stream",
    },
  });
}

/**
 * layer.json, with the tile URL templates versioned to bust stale caches, and carrying the signed
 * `t` token when the request used one.
 */
async function serveTerrainMetadata(layerId: string, signed: string | null): Promise<Response> {
  await abortUnlessPublished(layerId);

  let raw: string;
  try {
    raw = await storage.readText("public", `terrain-tiles/${layerId}/layer.json`);
  } catch (error) {
    if (isMissingFileError(error)) {
      return new Response("Metadata not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
      });
    }
    throw error;
  }

  const metadata = JSON.parse(raw) as { tiles?: unknown };
  if (metadata.tiles && typeof metadata.tiles === "object") {
    const tiles = metadata.tiles as Record<string, unknown>;
    for (const index of Object.keys(tiles)) {
      const template = String(tiles[index]);
      const separator = template.includes("?") ? "&" : "?";
      const versioned = `${template}${separator}terrain_revision=${TERRAIN_TILE_REVISION}`;
      tiles[index] = signed !== null ? withTerrainToken(versioned, signed) : versioned;
    }
  }

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
  });
}
