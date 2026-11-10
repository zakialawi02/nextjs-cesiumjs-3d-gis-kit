import type { LayerCategory, TerrainDetail, VectorDetail } from "@prisma/client";

import { formatDate } from "@/lib/format";

/**
 * JSON shapes shared by the geodata endpoints (port of the Laravel model accessors), so the layer
 * list, the upload status endpoint and the dashboard describe a layer the same way.
 */

/** Icon files the app stores itself: icons/layer-categories/<random>.(png|webp) on the public disk. */
export const ICON_PATH_PATTERN = /^(layer-categories)\/[A-Za-z0-9]{1,64}\.(png|webp)$/;

/** URL of an uploaded category icon (served behind auth by /geodata/icons/...), or null. */
export function categoryIconUrl(iconPath: string | null | undefined): string | null {
  if (!iconPath || !iconPath.startsWith("icons/")) return null;
  const path = iconPath.slice("icons/".length);
  return ICON_PATH_PATTERN.test(path) ? `/geodata/icons/${path}` : null;
}

export function presentCategory(category: Pick<LayerCategory, "id" | "name" | "slug" | "color" | "icon_path">) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    color: category.color,
    icon_url: categoryIconUrl(category.icon_path),
  };
}

/** TerrainDetail::tileset_url (relative URLs stay relative: same origin as the page). */
export function terrainTilesetUrl(detail: Pick<TerrainDetail, "tileset_url">): string | null {
  return detail.tileset_url || null;
}

/** TerrainDetail::ortho_tiles_url: "/geodata/ortho/<layer id>_ortho/{z}/{x}/{y}.png". */
export function orthoTilesUrl(detail: Pick<TerrainDetail, "ortho_tiles_path">): string | null {
  if (!detail.ortho_tiles_path) return null;
  const folder = detail.ortho_tiles_path.split("/").pop();
  return folder ? `/geodata/ortho/${folder}/{z}/{x}/{y}.png` : null;
}

export function acquisitionDateLabel(value: Date | null | undefined): string {
  return formatDate(value, { utc: true }) ?? "N/A";
}

/** Full terrain detail payload used by the map layer list and the upload status endpoint. */
export function presentTerrainDetail(detail: TerrainDetail) {
  return {
    tileset_url: terrainTilesetUrl(detail),
    has_ortho: detail.has_ortho,
    native_bounding_box: detail.native_bounding_box,
    acquisition_date: acquisitionDateLabel(detail.acquisition_date),
    has_ortho_tiles: Boolean(detail.ortho_tiles_path),
    ortho_tiles_url: orthoTilesUrl(detail),
    ortho_min_zoom: detail.ortho_min_zoom,
    ortho_max_zoom: detail.ortho_max_zoom,
  };
}

export function presentVectorDetail(detail: VectorDetail) {
  return {
    geometry_type: detail.geometry_type,
    feature_count: detail.feature_count,
    native_bounding_box: detail.native_bounding_box,
    acquisition_date: acquisitionDateLabel(detail.acquisition_date),
  };
}
