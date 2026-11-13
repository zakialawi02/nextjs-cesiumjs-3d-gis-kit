import { LayerStatus, LayerType } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { signTerrainToken, TERRAIN_URL_SECONDS } from "@/server/geodata/terrain-url";
import { abort, abortUnless, handler, json } from "@/server/http";
import { NO_STORE, requireMobileUser } from "@/server/mobile-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LAYER_ID_PATTERN = /^[0-9A-Za-z]{26}$/;

/**
 * GET /api/mobile/layers/{layerId}/terrain-url: a signed layer.json URL of a published terrain
 * layer, for clients that cannot send an Authorization header with tile requests (Cesium for
 * Unity). It works for this layer only and for 12 hours; ask for a new one after that.
 */
export const GET = handler<{ layerId: string }>(async (request, { params }) => {
  const user = await requireMobileUser(request);
  const { layerId } = await params;
  if (!LAYER_ID_PATTERN.test(layerId)) abort(404);

  const layer = await prisma.layer.findFirst({
    where: { id: layerId, status: LayerStatus.Published, layer_type: LayerType.Terrain },
    select: { id: true },
  });
  abortUnless(layer, 404);

  const { token, expiresAt } = signTerrainToken(layerId, user);
  return json(
    {
      layer_json_url: `/geodata/terrain/${layerId}/layer.json?t=${encodeURIComponent(token)}`,
      expires_in: TERRAIN_URL_SECONDS,
      expires_at: expiresAt.toISOString(),
    },
    { headers: NO_STORE },
  );
});
