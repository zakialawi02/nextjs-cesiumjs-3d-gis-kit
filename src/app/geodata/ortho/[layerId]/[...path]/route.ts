import { abortUnlessPublished, isMissingFileError } from "@/server/geodata/published-layer";
import { requireApiUser } from "@/server/auth";
import { abort, handler } from "@/server/http";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

const LAYER_ID_PATTERN = /^([0-9A-Za-z]{26})_ortho$/;
const TILE_PATTERN = /^([0-9]{1,2})\/([0-9]{1,9})\/([0-9]{1,9})\.png$/;

/**
 * GET /geodata/ortho/{layerId}_ortho/{z}/{x}/{y}.png (GeodataLayerController::serveOrthoTile):
 * XYZ orthophoto tiles from storage/app/public/xyz-tiles/<layerId>_ortho, only for published layers.
 */
export const GET = handler<{ layerId: string; path: string[] }>(async (_request, { params }) => {
  const { layerId, path } = await params;
  const layer = LAYER_ID_PATTERN.exec(layerId);
  const tile = TILE_PATTERN.exec(path.join("/"));
  if (!layer || !tile) abort(404);

  await requireApiUser();
  await abortUnlessPublished(layer[1]);

  let file: Buffer;
  try {
    file = await storage.read(
      "public",
      `xyz-tiles/${layerId}/${tile[1]}/${tile[2]}/${tile[3]}.png`,
    );
  } catch (error) {
    if (isMissingFileError(error)) return new Response("", { status: 404 });
    throw error;
  }

  return new Response(new Uint8Array(file), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=604800",
    },
  });
});
