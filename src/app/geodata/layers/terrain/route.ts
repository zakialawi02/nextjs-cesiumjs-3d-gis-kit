import { LayerStatus, LayerType } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth";
import { acquisitionDateLabel, terrainTilesetUrl } from "@/server/geodata/presenters";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** $request->integer('limit', 30), clamped to 1..100 (PHP intval: "abc" → 0 → 1). */
function limitParam(value: string | null): number {
  const parsed = value === null ? 30 : Number.parseInt(value, 10);
  const limit = Number.isNaN(parsed) ? 0 : parsed;
  return Math.min(Math.max(limit, 1), 100);
}

/**
 * GET /geodata/layers/terrain?limit= (GeodataLayerController::listTerrainLayers): published
 * terrain layers for the "comparison terrain" dropdowns of the Cut & Fill and Profile tools.
 */
export const GET = handler(async (request) => {
  await requireApiUser();

  const layers = await prisma.layer.findMany({
    where: { layer_type: LayerType.Terrain, status: LayerStatus.Published },
    include: { terrain_detail: true },
    orderBy: { created_at: "desc" },
    take: limitParam(request.nextUrl.searchParams.get("limit")),
  });

  return json({
    success: true,
    layers: layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      terrain_detail: layer.terrain_detail
        ? {
            tileset_url: terrainTilesetUrl(layer.terrain_detail),
            acquisition_date: acquisitionDateLabel(layer.terrain_detail.acquisition_date),
          }
        : null,
    })),
  });
});
