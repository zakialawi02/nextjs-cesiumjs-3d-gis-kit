import type { Prisma } from "@prisma/client";

import { LayerStatus, LayerType } from "@/lib/enums";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth";
import {
  categoryIconUrl,
  presentTerrainDetail,
  presentVectorDetail,
} from "@/server/geodata/presenters";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

const layerInclude = { terrain_detail: true, vector_detail: true } satisfies Prisma.LayerInclude;
type LayerWithDetails = Prisma.LayerGetPayload<{ include: typeof layerInclude }>;

/** GeodataLayerController::formatLayer() */
function formatLayer(layer: LayerWithDetails) {
  const item: Record<string, unknown> = {
    id: layer.id,
    name: layer.name,
    layer_type: layer.layer_type,
    // Carbon "d M Y" in the app timezone (UTC).
    created_at: formatDate(layer.created_at, { utc: true }),
  };

  if (layer.layer_type === LayerType.Terrain && layer.terrain_detail) {
    item.terrain_detail = presentTerrainDetail(layer.terrain_detail);
  }

  if (layer.layer_type === LayerType.Vector && layer.vector_detail) {
    item.vector_detail = presentVectorDetail(layer.vector_detail);
  }

  return item;
}

/**
 * Filters of the layer list: published only, name contains `search` (case-insensitive) and
 * uploaded in the `month_year` ("YYYY-MM") month.
 */
function layerFilters(search: string, monthYear: string): Prisma.LayerWhereInput {
  const where: Prisma.LayerWhereInput = { status: LayerStatus.Published };

  if (search !== "") {
    where.name = { contains: search, mode: "insensitive" };
  }

  const parts = /^(\d{4})-(\d{2})$/.exec(monthYear);
  if (parts) {
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    // whereYear() + whereMonth() on created_at (stored in UTC); "2026-13" matches nothing.
    where.created_at =
      month >= 1 && month <= 12
        ? { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) }
        : { lt: new Date(0), gt: new Date(0) };
  }

  return where;
}

/**
 * GET /geodata/layers/all (GeodataLayerController::listAllLayers): published layers (terrain and
 * vector) grouped by category. Uncategorized layers are merged into the "other" category.
 */
export const GET = handler(async (request) => {
  await requireApiUser();

  const { searchParams } = request.nextUrl;
  const search = (searchParams.get("search") ?? "").trim();
  const monthYear = searchParams.get("month_year") ?? "";
  const where = layerFilters(search, monthYear);

  const [categories, uncategorized] = await Promise.all([
    prisma.layerCategory.findMany({
      orderBy: { sort_order: "asc" },
      include: { layers: { where, include: layerInclude, orderBy: { created_at: "desc" } } },
    }),
    prisma.layer.findMany({
      where: { ...where, layer_category_id: null },
      include: layerInclude,
      orderBy: { created_at: "desc" },
    }),
  ]);

  const otherCategory = categories.find((category) => category.slug === "other");
  if (uncategorized.length > 0 && otherCategory) {
    // Stable sort, newest first (Collection::sortByDesc('created_at')).
    otherCategory.layers = [...otherCategory.layers, ...uncategorized].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    );
  }

  const payload = categories
    .filter((category) => category.layers.length > 0)
    .map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      color: category.color,
      icon_url: categoryIconUrl(category.icon_path),
      layers: category.layers.map(formatLayer),
    }));

  return json({ success: true, categories: payload });
});
