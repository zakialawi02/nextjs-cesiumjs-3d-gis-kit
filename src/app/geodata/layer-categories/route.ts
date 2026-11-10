import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth";
import { presentCategory } from "@/server/geodata/presenters";
import { handler, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /geodata/layer-categories (LayerCategoryController::list): categories for the upload form. */
export const GET = handler(async () => {
  await requireApiUser();

  const categories = await prisma.layerCategory.findMany({ orderBy: { sort_order: "asc" } });

  return json({ success: true, categories: categories.map(presentCategory) });
});
