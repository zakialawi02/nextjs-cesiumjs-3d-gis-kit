"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { JOB_STATUS_LABELS, JobStatus, LayerStatus, LayerType } from "@/lib/enums";
import { formatBytes, formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/auth";
import { formatDateTimeShort, formatTime, numberFormat, statusLabel, strLimit, ucfirst } from "@/server/dashboard/format";
import {
  formValues,
  invalid,
  messages,
  nullableString,
  parseDateYmd,
  requiredString,
  todayYmd,
  zodFieldErrors,
  type ActionResult,
} from "@/server/dashboard/validation";

const LAYERS_PATH = "/dashboard/layers";

export type LayerDetail = {
  id: string;
  name: string;
  rows: Array<[label: string, value: string]>;
  bbox: string | null;
  errorMessage: string | null;
  lastRun: string | null;
};

function layerId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9A-Za-z]{1,64}$/.test(value) ? value : null;
}

function boundingBoxLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const box = value as Record<string, unknown>;
  const keys = ["west", "south", "east", "north"] as const;
  if (keys.some((key) => box[key] === null || box[key] === undefined)) return null;
  const [west, south, east, north] = keys.map((key) => numberFormat(Number(box[key]) || 0, 6));
  return `W ${west} · S ${south} · E ${east} · N ${north}`;
}

/** LayerController::show — the data of the "View" modal (layers/partials/detail.blade.php). */
export async function getLayerDetailAction(id: string): Promise<{ ok: true; detail: LayerDetail } | { ok: false; message: string }> {
  await requireAdmin();

  const key = layerId(id);
  const layer = key
    ? await prisma.layer.findUnique({
        where: { id: key },
        include: {
          category: { select: { name: true } },
          user: { select: { name: true } },
          job: {
            include: {
              source_file: { select: { original_name: true, file_size: true } },
              ortho_file: { select: { original_name: true, file_size: true } },
              logs: { orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 1 },
            },
          },
          terrain_detail: true,
          vector_detail: true,
        },
      })
    : null;

  if (!layer) return { ok: false, message: "Failed to load layer details." };

  const isTerrain = layer.layer_type === LayerType.Terrain;
  const terrain = isTerrain ? layer.terrain_detail : null;
  const vector = isTerrain ? null : layer.vector_detail;
  const detail = terrain ?? vector;
  const job = layer.job;
  const totalSize = Number(job?.source_file?.file_size ?? 0) + Number(job?.ortho_file?.file_size ?? 0);

  const entries: Array<[string, string | null | undefined]> = [
    ["Type", ucfirst(layer.layer_type)],
    ["Status", statusLabel(layer.status)],
    ["Category", layer.category?.name ?? "Uncategorized"],
    ["Uploaded by", layer.user?.name ?? "System"],
    ["Uploaded", formatDateTimeShort(layer.created_at)],
    ["Published", formatDateTimeShort(layer.published_at)],
    ["Acquisition date", formatDate(detail?.acquisition_date, { utc: true })],
    ["Source file", job?.source_file?.original_name],
    ["Orthophoto", job?.ortho_file?.original_name],
    ["Total size", formatBytes(totalSize)],
    ["Source CRS", detail?.srs ?? (vector?.source_epsg ? `EPSG:${vector.source_epsg}` : null)],
    ["Geometry type", isTerrain ? null : vector?.geometry_type],
    ["Features", isTerrain ? null : vector ? numberFormat(vector.feature_count) : null],
    [
      "Orthophoto tiles",
      isTerrain
        ? terrain?.ortho_tiles_path
          ? `Available (zoom ${terrain.ortho_min_zoom ?? ""}–${terrain.ortho_max_zoom ?? ""})`
          : "None"
        : null,
    ],
    [
      "Conversion",
      job
        ? `${JOB_STATUS_LABELS[job.status as JobStatus] ?? job.status}${job.conversion_tool ? ` • ${job.conversion_tool}` : ""}`
        : null,
    ],
  ];

  const log = job?.logs[0];
  let lastRun: string | null = null;
  if (log) {
    lastRun = `Last run: attempt ${log.attempt} • started ${formatDateTimeShort(log.started_at) ?? ""}`;
    if (log.finished_at) lastRun += ` • finished ${formatTime(log.finished_at)}`;
    if (log.exit_code !== null) lastRun += ` • exit code ${log.exit_code}`;
  }

  return {
    ok: true,
    detail: {
      id: layer.id,
      name: layer.name,
      rows: entries.filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined && entry[1] !== ""),
      bbox: boundingBoxLabel(detail?.native_bounding_box),
      errorMessage: job?.error_message ? strLimit(job.error_message, 2000) : null,
      lastRun,
    },
  };
}

/** LayerController::update (UpdateLayerRequest): rename, recategorise or re-date a layer. */
export async function updateLayerAction(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const key = layerId(id);
  const layer = key
    ? await prisma.layer.findUnique({
        where: { id: key },
        select: { id: true, layer_type: true, terrain_detail: { select: { id: true } }, vector_detail: { select: { id: true } } },
      })
    : null;
  if (!layer) return { ok: false, message: "Layer not found." };

  const input = formValues(formData, ["name", "layer_category_id", "acquisition_date"]);
  const today = todayYmd();
  const schema = z.object({
    name: requiredString("name").max(255, messages.maxString("name", 255)),
    layer_category_id: nullableString("layer_category_id"),
    acquisition_date: nullableString("acquisition_date").superRefine((value, ctx) => {
      if (typeof value !== "string") return;
      if (!parseDateYmd(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.dateFormat("acquisition_date", "Y-m-d") });
      } else if (value > today) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.beforeOrEqual("acquisition_date", "today") });
      }
    }),
  });

  const parsed = schema.safeParse(input);
  const errors = parsed.success ? {} : zodFieldErrors(parsed.error);

  const categoryId = typeof input.layer_category_id === "string" ? input.layer_category_id : null;
  if (categoryId && !(await prisma.layerCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    (errors.layer_category_id ??= []).push(messages.exists("layer_category_id"));
  }
  if (!parsed.success || Object.keys(errors).length > 0) return invalid(errors);

  const { name, acquisition_date } = parsed.data;
  const acquisitionDate = acquisition_date ? parseDateYmd(acquisition_date) : null;

  await prisma.$transaction(async (tx) => {
    const fallback = categoryId
      ? null
      : await tx.layerCategory.findUnique({ where: { slug: "other" }, select: { id: true } });

    await tx.layer.update({
      where: { id: layer.id },
      data: { name, layer_category_id: categoryId ?? fallback?.id ?? null },
    });

    if (layer.layer_type === LayerType.Terrain && layer.terrain_detail) {
      await tx.terrainDetail.update({ where: { id: layer.terrain_detail.id }, data: { acquisition_date: acquisitionDate } });
    } else if (layer.layer_type !== LayerType.Terrain && layer.vector_detail) {
      await tx.vectorDetail.update({ where: { id: layer.vector_detail.id }, data: { acquisition_date: acquisitionDate } });
    }
  });

  revalidatePath(LAYERS_PATH);
  return { ok: true, message: `Layer "${name}" updated.` };
}

/** LayerController::archive: hide a published layer from the map without deleting any data. */
export async function archiveLayerAction(id: string): Promise<ActionResult> {
  await requireAdmin();

  const key = layerId(id);
  const layer = key ? await prisma.layer.findUnique({ where: { id: key }, select: { id: true, name: true, status: true } }) : null;
  if (!layer) return { ok: false, message: "Layer not found." };

  const updated = await prisma.layer.updateMany({
    where: { id: layer.id, status: LayerStatus.Published },
    data: { status: LayerStatus.Archived },
  });
  if (updated.count === 0) return { ok: false, message: "Only published layers can be archived." };

  revalidatePath(LAYERS_PATH);
  return { ok: true, message: `Layer "${layer.name}" archived. It is hidden from the map.` };
}

/** LayerController::restore: put an archived layer (with a finished conversion) back on the map. */
export async function restoreLayerAction(id: string): Promise<ActionResult> {
  await requireAdmin();

  const key = layerId(id);
  const layer = key
    ? await prisma.layer.findUnique({
        where: { id: key },
        select: { id: true, name: true, status: true, job: { select: { status: true } } },
      })
    : null;
  if (!layer) return { ok: false, message: "Layer not found." };
  if (layer.status !== LayerStatus.Archived) return { ok: false, message: "Only archived layers can be restored." };
  if (layer.job?.status !== JobStatus.Done) {
    return { ok: false, message: "The layer has no completed conversion to restore." };
  }

  const updated = await prisma.layer.updateMany({
    where: { id: layer.id, status: LayerStatus.Archived },
    data: { status: LayerStatus.Published },
  });
  if (updated.count === 0) return { ok: false, message: "Only archived layers can be restored." };

  revalidatePath(LAYERS_PATH);
  return { ok: true, message: `Layer "${layer.name}" restored to the map.` };
}
