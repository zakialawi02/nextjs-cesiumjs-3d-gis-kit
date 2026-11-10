import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/auth";
import { plural } from "@/server/dashboard/format";
import { queryFromSearchParams } from "@/server/dashboard/pagination";
import { categoryIconUrl } from "@/server/geodata/presenters";

import { CategoriesManager, type CategoryRow } from "./categories-manager";

export const metadata: Metadata = { title: "Layer Categories" };

const PATH = "/dashboard/layer-categories";
const PROTECTED_SLUG = "other";

/** LayerCategoryController::index: categories with their layer counts. */
export default async function LayerCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin(PATH);

  const search = (queryFromSearchParams(await searchParams).search ?? "").trim();

  const categories = await prisma.layerCategory.findMany({
    where: search !== "" ? { name: { contains: search, mode: "insensitive" } } : undefined,
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    include: { _count: { select: { layers: true } } },
  });

  const rows: CategoryRow[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    color: category.color,
    description: category.description,
    sortOrder: category.sort_order,
    iconUrl: categoryIconUrl(category.icon_path),
    layerCount: category._count.layers,
    layerCountLabel: `${category._count.layers} ${plural("layer", category._count.layers)}`,
    isProtected: category.slug === PROTECTED_SLUG,
  }));

  return (
    <CategoriesManager
      rows={rows}
      search={search}
      totalLayers={rows.reduce((sum, row) => sum + row.layerCount, 0)}
    />
  );
}
