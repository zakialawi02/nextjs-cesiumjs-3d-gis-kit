import type { Prisma } from "@prisma/client";
import { CloudUpload, Funnel, Search, X } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import { ButtonPrimary } from "@/components/app/buttons";
import { SelectInput, TextInput } from "@/components/app/form-fields";
import { Pagination } from "@/components/app/pagination";
import { LAYER_STATUSES, LAYER_TYPES, LayerType, type LayerStatus } from "@/lib/enums";
import { diffForHumans, formatBytes, toDateInputValue } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth";
import { formatTimestamp, statusLabel, ucfirst } from "@/server/dashboard/format";
import { paginate, PER_PAGE, queryFromSearchParams, resolvePage } from "@/server/dashboard/pagination";
import { todayYmd } from "@/server/dashboard/validation";

import { LayersTable, type LayerRow } from "./layers-table";

export const metadata: Metadata = { title: "Layer Management" };

const PATH = "/dashboard/layers";

type Filters = { search: string; type: string | null; status: string | null; category: string };

/** URL of the list with `overrides` applied; empty values are dropped (array_filter in the view). */
function filterUrl(filters: Filters, overrides: Partial<Filters>): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const key of ["search", "type", "status", "category"] as const) {
    const value = merged[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${PATH}?${query}` : PATH;
}

/** LayerController::index: searchable, filterable list of every layer in any status. */
export default async function LayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin(PATH);

  const query = queryFromSearchParams(await searchParams);
  const filters: Filters = {
    search: (query.search ?? "").trim(),
    type: (LAYER_TYPES as string[]).includes(query.type ?? "") ? query.type! : null,
    status: (LAYER_STATUSES as string[]).includes(query.status ?? "") ? query.status! : null,
    category: query.category ?? "",
  };
  const hasFilters = filters.search !== "" || Boolean(filters.type) || Boolean(filters.status) || filters.category !== "";
  const page = resolvePage(query.page);

  const where: Prisma.LayerWhereInput = {
    ...(filters.search !== "" ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    ...(filters.type ? { layer_type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category !== "" ? { layer_category_id: filters.category } : {}),
  };

  const [total, layers, statusGroups, categories] = await Promise.all([
    prisma.layer.count({ where }),
    prisma.layer.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        category: { select: { id: true, name: true, color: true } },
        user: { select: { id: true, name: true } },
        job: {
          select: {
            id: true,
            status: true,
            source_file: { select: { file_size: true } },
            ortho_file: { select: { file_size: true } },
          },
        },
        terrain_detail: { select: { acquisition_date: true } },
        vector_detail: { select: { acquisition_date: true } },
      },
    }),
    prisma.layer.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.layerCategory.findMany({ orderBy: [{ sort_order: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
  ]);

  const statusCounts = new Map(statusGroups.map((group) => [group.status, group._count._all]));
  const allCount = [...statusCounts.values()].reduce((sum, count) => sum + count, 0);
  const otherCategoryId = (await prisma.layerCategory.findUnique({ where: { slug: "other" }, select: { id: true } }))?.id ?? null;
  const now = new Date();

  const rows: LayerRow[] = layers.map((layer) => {
    const detail = layer.layer_type === LayerType.Terrain ? layer.terrain_detail : layer.vector_detail;
    const size = Number(layer.job?.source_file?.file_size ?? 0) + Number(layer.job?.ortho_file?.file_size ?? 0);
    return {
      id: layer.id,
      name: layer.name,
      isTerrain: layer.layer_type === LayerType.Terrain,
      typeLabel: ucfirst(layer.layer_type),
      status: layer.status,
      statusLabel: statusLabel(layer.status),
      categoryName: layer.category?.name ?? "Uncategorized",
      categoryColor: layer.category?.color ?? "#6b7280",
      size: formatBytes(size),
      uploader: layer.user?.name ?? "System",
      createdAgo: diffForHumans(layer.created_at, now),
      createdTitle: formatTimestamp(layer.created_at),
      edit: {
        name: layer.name,
        layer_category_id: layer.layer_category_id ?? otherCategoryId ?? categories[0]?.id ?? "",
        acquisition_date: toDateInputValue(detail?.acquisition_date) ?? "",
      },
    };
  });

  const paginator = paginate({ total, currentPage: page, itemCount: layers.length, path: PATH, query });
  const chipClass = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-semibold transition",
      active ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/70 hover:bg-muted",
    );

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-foreground">Layer Management</h2>
          <p className="text-sm text-foreground/60">Rename, recategorize, archive or delete uploaded terrain and vector layers.</p>
        </div>
        <ButtonPrimary href="/" className="text-sm">
          <CloudUpload className="size-3.5" aria-hidden="true" /> Upload on Map
        </ButtonPrimary>
      </section>

      {/* Status chips (quick filters) */}
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        <Link href={filterUrl(filters, { status: null })} className={chipClass(!filters.status)}>
          All <span className="opacity-70">{allCount}</span>
        </Link>
        {LAYER_STATUSES.filter((status) => statusCounts.has(status)).map((status: LayerStatus) => (
          <Link key={status} href={filterUrl(filters, { status })} className={cn(chipClass(filters.status === status), "capitalize")}>
            {statusLabel(status)} <span className="opacity-70">{statusCounts.get(status)}</span>
          </Link>
        ))}
      </nav>

      {/* Filters */}
      <Form
        action={PATH}
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-neutral p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="lg:col-span-2">
          <label htmlFor="search" className="sr-only">
            Search
          </label>
          <TextInput
            id="search"
            name="search"
            type="search"
            icon={Search}
            placeholder="Search layer name..."
            defaultValue={filters.search}
            key={`search-${filters.search}`}
          />
        </div>
        <SelectInput name="type" aria-label="Layer type" defaultValue={filters.type ?? ""} key={`type-${filters.type ?? ""}`}>
          <option value="">All types</option>
          {LAYER_TYPES.map((type) => (
            <option key={type} value={type}>
              {ucfirst(type)}
            </option>
          ))}
        </SelectInput>
        <SelectInput name="category" aria-label="Category" defaultValue={filters.category} key={`category-${filters.category}`}>
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </SelectInput>
        <div className="flex gap-2">
          {filters.status ? <input type="hidden" name="status" value={filters.status} /> : null}
          <ButtonPrimary type="submit" className="flex-1 text-sm">
            <Funnel className="size-3.5" aria-hidden="true" /> Filter
          </ButtonPrimary>
          {hasFilters ? (
            <Link
              href={PATH}
              className="inline-flex items-center justify-center rounded-[0.625rem] border border-border px-3 text-sm hover:bg-muted"
              title="Reset filters"
              aria-label="Reset filters"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </Form>

      {/* Table */}
      <section className="overflow-hidden rounded-xl border border-border bg-neutral shadow-sm">
        <LayersTable
          rows={rows}
          categories={categories.map(({ id, name }) => ({ id, name }))}
          today={todayYmd(now)}
          emptyMessage={hasFilters ? "No layers match these filters." : "No layers yet. Upload data from the Data panel on the map."}
        />
        {paginator.hasPages ? (
          <div className="border-t border-border px-4 py-3">
            <Pagination paginator={paginator} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
