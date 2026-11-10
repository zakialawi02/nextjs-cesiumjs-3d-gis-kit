"use server";

import { randomInt } from "node:crypto";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { slugify } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/auth";
import { iconErrors, readImageInfo } from "@/server/dashboard/image-header";
import {
  formValues,
  invalid,
  messages,
  nullableString,
  requiredString,
  zodFieldErrors,
  type ActionResult,
  type FieldErrors,
} from "@/server/dashboard/validation";
import { storage } from "@/server/storage";

const CATEGORIES_PATH = "/dashboard/layer-categories";
const PROTECTED_SLUG = "other";
const ICON_DIR = "icons/layer-categories";
// Only files this page stored (server-generated names inside the icon folder) are ever deleted.
const STORED_ICON = /^icons\/layer-categories\/[A-Za-z0-9]{1,64}\.(png|webp)$/;
const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function categoryId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9A-Za-z]{1,64}$/.test(value) ? value : null;
}

function randomName(length = 40): string {
  let name = "";
  for (let i = 0; i < length; i++) name += ALPHANUMERIC[randomInt(ALPHANUMERIC.length)];
  return name;
}

async function deleteIcon(path: string | null): Promise<void> {
  if (path && STORED_ICON.test(path)) {
    await storage.delete("public", path).catch((error) => console.error("Could not delete category icon:", error));
  }
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "category";
  let slug = base;
  for (let i = 2; await prisma.layerCategory.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }
  return slug;
}

const BOOLEAN_VALUES = new Map<unknown, boolean>([
  [undefined, false],
  [null, false],
  ["1", true],
  ["0", false],
  ["true", true],
  ["false", false],
  ["on", true],
]);

/**
 * SaveLayerCategoryRequest: name, #rrggbb color, description ≤ 200, sort order 0–9999, optional
 * PNG/WebP icon ≤ 512 KB and ≤ 512×512 px (checked from the file's bytes), remove_icon flag.
 */
type CategoryInput = {
  name: string;
  color: string;
  description: string | null;
  sort_order: number;
  remove_icon: boolean;
  icon: { bytes: Uint8Array; extension: "png" | "webp" } | null;
};

async function validateCategory(formData: FormData): Promise<{ ok: false; errors: FieldErrors } | { ok: true; data: CategoryInput }> {
  const input = formValues(formData, ["name", "color", "description", "sort_order", "remove_icon"]);
  const schema = z.object({
    name: requiredString("name").max(100, messages.maxString("name", 100)),
    color: requiredString("color").regex(/^#[0-9a-fA-F]{6}$/, "The color must be a hex value such as #047857."),
    description: nullableString("description").refine((value) => !value || value.length <= 200, {
      message: messages.maxString("description", 200),
    }),
    sort_order: nullableString("sort_order").superRefine((value, ctx) => {
      if (value === null || value === undefined) return;
      if (!/^[+-]?\d+$/.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.integer("sort_order") });
        return;
      }
      const number = Number(value);
      if (number < 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.minNumeric("sort_order", 0) });
      if (number > 9999) ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.maxNumeric("sort_order", 9999) });
    }),
  });

  const parsed = schema.safeParse(input);
  const errors = parsed.success ? {} : zodFieldErrors(parsed.error);

  if (!BOOLEAN_VALUES.has(input.remove_icon)) (errors.remove_icon ??= []).push(messages.boolean("remove_icon"));

  // An empty file input submits an empty File (its name varies by browser and by how the
  // Server Action serialises it, e.g. "" or "undefined"): treat any 0-byte file as "no icon".
  const rawIcon = formData.get("icon");
  let icon: { bytes: Uint8Array; extension: "png" | "webp" } | null = null;
  if (rawIcon !== null && rawIcon !== "" && !(rawIcon instanceof File && rawIcon.size === 0)) {
    if (!(rawIcon instanceof File)) {
      (errors.icon ??= []).push("The icon field must be a file.");
    } else {
      const bytes = new Uint8Array(await rawIcon.arrayBuffer());
      const info = readImageInfo(bytes);
      const problems = iconErrors(info, rawIcon.size);
      if (problems.length > 0) errors.icon = [...(errors.icon ?? []), ...problems];
      else if (info) icon = { bytes, extension: info.type };
    }
  }

  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name: parsed.data.name,
      color: parsed.data.color,
      description: parsed.data.description ?? null,
      sort_order: parsed.data.sort_order ? Number(parsed.data.sort_order) : 0,
      remove_icon: BOOLEAN_VALUES.get(input.remove_icon) ?? false,
      icon,
    },
  };
}

async function storeIcon(icon: { bytes: Uint8Array; extension: string }): Promise<string> {
  const path = `${ICON_DIR}/${randomName()}.${icon.extension}`;
  await storage.write("public", path, icon.bytes);
  return path;
}

/** LayerCategoryController::store / update (`id` empty = create). */
export async function saveCategoryAction(id: string | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();

  const existing = id === null ? null : await prisma.layerCategory.findUnique({ where: { id: categoryId(id) ?? "" } });
  if (id !== null && !existing) return { ok: false, message: "Category not found." };

  const result = await validateCategory(formData);
  if (!result.ok) return invalid(result.errors);
  const { name, color, description, sort_order, remove_icon, icon } = result.data;

  const newIconPath = icon ? await storeIcon(icon) : null;

  try {
    if (!existing) {
      // Retry on a concurrent insert of the same slug (unique constraint).
      for (let attempt = 0; ; attempt++) {
        try {
          await prisma.layerCategory.create({
            data: { name, color, description, sort_order, slug: await uniqueSlug(name), icon_path: newIconPath },
          });
          break;
        } catch (error) {
          if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
          throw error;
        }
      }

      revalidatePath(CATEGORIES_PATH);
      return { ok: true, message: `Category "${name}" created.` };
    }

    const replaceIcon = remove_icon || newIconPath !== null;
    await prisma.layerCategory.update({
      where: { id: existing.id },
      data: { name, color, description, sort_order, ...(replaceIcon ? { icon_path: newIconPath } : {}) },
    });
    if (replaceIcon) await deleteIcon(existing.icon_path);

    revalidatePath(CATEGORIES_PATH);
    return { ok: true, message: `Category "${name}" updated.` };
  } catch (error) {
    await deleteIcon(newIconPath);
    throw error;
  }
}

/** LayerCategoryController::destroy: layers move to the protected "Other" category in the same transaction. */
export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  await requireAdmin();

  const category = await prisma.layerCategory.findUnique({ where: { id: categoryId(id) ?? "" } });
  if (!category) return { ok: false, message: "Category not found." };
  if (category.slug === PROTECTED_SLUG) {
    return { ok: false, message: 'The default "Other" category cannot be deleted.' };
  }

  const moved = await prisma.$transaction(async (tx) => {
    const other = await tx.layerCategory.findUnique({ where: { slug: PROTECTED_SLUG }, select: { id: true } });
    const result = await tx.layer.updateMany({
      where: { layer_category_id: category.id },
      data: { layer_category_id: other?.id ?? null },
    });
    await tx.layerCategory.delete({ where: { id: category.id } });
    return result.count;
  });

  await deleteIcon(category.icon_path);

  revalidatePath(CATEGORIES_PATH);
  return {
    ok: true,
    message: `Category "${category.name}" deleted${moved ? ` and ${moved} layer(s) moved to Other.` : "."}`,
  };
}
