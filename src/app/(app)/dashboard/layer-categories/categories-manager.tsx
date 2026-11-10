"use client";

/* eslint-disable @next/next/no-img-element -- icons are served behind auth by /geodata/icons and previewed from blob: URLs */
import { Folders, Layers, LoaderCircle, Lock, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { GENERIC_ERROR, rethrowNavigationError } from "@/components/app/action-helpers";
import { ButtonLight, ButtonPrimary } from "@/components/app/buttons";
import { EmptyState } from "@/components/app/empty-state";
import { InputError, InputLabel, TextInput } from "@/components/app/form-fields";
import { Modal, ModalCloseButton, ModalTitle } from "@/components/app/modal";
import { confirmPopup, DANGER_ICON } from "@/lib/client/popup-alert";
import { toast } from "@/lib/client/toast";
import type { FieldErrors } from "@/server/dashboard/validation";
import { createRecordDialogStore } from "@/stores/record-dialog-store";
import { createScopedStore } from "@/stores/scoped-store";

import { deleteCategoryAction, saveCategoryAction } from "./actions";

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  sortOrder: number;
  iconUrl: string | null;
  layerCount: number;
  layerCountLabel: string;
  isProtected: boolean;
};

const DEFAULT_COLOR = "#047857";
const ICON_MAX_BYTES = 512 * 1024;
const isHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

/** The create/edit modal's category (`null` creates), shared by the "New" button, the rows and the modal. */
const [CategoryDialogProvider, useCategoryDialog] = createScopedStore("CategoryDialog", () =>
  createRecordDialogStore<"form", CategoryRow>(),
);

/** Port of pages/dashboard/layer-categories/index.blade.php (list, search, create/edit modal, delete). */
export function CategoriesManager(props: { rows: CategoryRow[]; search: string; totalLayers: number }) {
  return (
    <CategoryDialogProvider>
      <CategoriesList {...props} />
      <CategoryFormModal />
    </CategoryDialogProvider>
  );
}

function CategoriesList({ rows, search, totalLayers }: { rows: CategoryRow[]; search: string; totalLayers: number }) {
  const openDialog = useCategoryDialog((state) => state.openDialog);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function remove(row: CategoryRow) {
    const confirmed = await confirmPopup({
      message: `Delete "${row.name}"?${row.layerCount ? ` Its ${row.layerCount} layer(s) will move to Other.` : ""}`,
      icon: DANGER_ICON,
      confirmText: "OK",
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    setDeletingId(row.id);
    startTransition(async () => {
      try {
        const result = await deleteCategoryAction(row.id);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message ?? GENERIC_ERROR);
      } catch (error) {
        rethrowNavigationError(error);
        toast.error(GENERIC_ERROR);
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-foreground">Layer Categories</h2>
          <p className="text-sm text-foreground/60">
            Group layers in the map&apos;s Layer panel. {rows.length} categories • {totalLayers} layers.
          </p>
        </div>
        <ButtonPrimary type="button" className="text-sm" onClick={() => openDialog("form", null)}>
          <Plus className="size-3.5" aria-hidden="true" /> New Category
        </ButtonPrimary>
      </section>

      {/* Search */}
      <Form action="/dashboard/layer-categories" className="flex max-w-md gap-2">
        <div className="flex-1">
          <label htmlFor="search" className="sr-only">
            Search
          </label>
          <TextInput
            id="search"
            name="search"
            type="search"
            icon={Search}
            placeholder="Search category..."
            defaultValue={search}
            key={search}
          />
        </div>
        {search !== "" ? (
          <Link
            href="/dashboard/layer-categories"
            className="inline-flex items-center justify-center rounded-[0.625rem] border border-border px-3 text-sm hover:bg-muted"
            title="Clear search"
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </Form>

      {/* Table */}
      <section className="overflow-hidden rounded-xl border border-border bg-neutral shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/50 text-[11px] font-bold uppercase tracking-wider text-foreground/60">
              <tr>
                <th className="w-16 px-4 py-3">Order</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Layers</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length > 0 ? (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs text-foreground/60">{row.sortOrder}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/5"
                          style={{ backgroundColor: isHex(row.color) ? row.color : "#6b7280" }}
                        >
                          {row.iconUrl ? (
                            <img src={row.iconUrl} alt="" className="h-6 w-6 object-contain" />
                          ) : (
                            <Layers className="size-3.5 text-white" aria-hidden="true" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-semibold text-foreground">
                            {row.name}
                            {row.isProtected ? (
                              <span
                                className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-foreground/60"
                                title="Default category; layers from deleted categories move here"
                              >
                                Default
                              </span>
                            ) : null}
                          </p>
                          <p className="font-mono text-[10px] text-foreground/50">
                            {row.slug} • {row.color}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-sm px-4 py-3 text-xs text-foreground/70">{row.description || "—"}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/layers?category=${encodeURIComponent(row.id)}`}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        {row.layerCountLabel}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-foreground/60 hover:bg-primary/10 hover:text-primary"
                          title="Edit"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => openDialog("form", row)}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </button>
                        {row.isProtected ? (
                          <span className="cursor-not-allowed p-1.5 text-foreground/25" title="The default category cannot be deleted">
                            <Lock className="size-4" aria-hidden="true" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-foreground/60 hover:bg-error/10 hover:text-error disabled:opacity-40"
                            title="Delete"
                            aria-label={`Delete ${row.name}`}
                            disabled={deletingId === row.id}
                            onClick={() => remove(row)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={Folders}
                      iconClass="size-7.5"
                      message={search !== "" ? "No categories match your search." : "No layer categories yet."}
                      containerClass="py-12"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CategoryFormModal() {
  const open = useCategoryDialog((state) => state.kind === "form");
  const row = useCategoryDialog((state) => state.row);
  const session = useCategoryDialog((state) => state.session);
  const closeDialog = useCategoryDialog((state) => state.closeDialog);

  return (
    <Modal open={open} onOpenChange={(next) => next || closeDialog()} maxWidth="lg">
      <CategoryForm key={session} row={row} onDone={closeDialog} />
    </Modal>
  );
}

/** Create (`row` null) / edit form; remounted for every opening, so it starts from the row's values. */
function CategoryForm({ row, onDone }: { row: CategoryRow | null; onDone: () => void }) {
  const initialColor = row ? (isHex(row.color) ? row.color : "#6b7280") : DEFAULT_COLOR;
  const [form, setForm] = useState({
    name: row?.name ?? "",
    color: initialColor,
    sortOrder: String(row?.sortOrder ?? 0),
    description: row?.description ?? "",
  });
  const [pickerColor, setPickerColor] = useState(initialColor);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, startSaving] = useTransition();
  const previewRef = useRef<string | null>(null);

  // Release blob: URLs of icon previews.
  useEffect(() => {
    if (previewRef.current && previewRef.current !== filePreview) URL.revokeObjectURL(previewRef.current);
    previewRef.current = filePreview;
  }, [filePreview]);
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function setColor(value: string) {
    setForm((current) => ({ ...current, color: value }));
    if (isHex(value.trim())) setPickerColor(value.trim());
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    const icon = data.get("icon");
    if (icon instanceof File && icon.size > ICON_MAX_BYTES) {
      setErrors({ icon: ["The icon field must not be greater than 512 kilobytes."] });
      return;
    }

    const id = row?.id ?? null;
    startSaving(async () => {
      try {
        const result = await saveCategoryAction(id, data);
        if (result.ok) {
          toast.success(result.message);
          onDone();
        } else if (result.errors) {
          setErrors(result.errors);
        } else {
          toast.error(result.message ?? GENERIC_ERROR);
        }
      } catch (error) {
        rethrowNavigationError(error);
        toast.error(GENERIC_ERROR);
      }
    });
  }

  const existingIconUrl = row?.iconUrl ?? null;
  const previewImage = filePreview ?? (removeIcon ? null : existingIconUrl);

  return (
    <form className="space-y-4 p-6" onSubmit={submit} encType="multipart/form-data">
      <div className="flex items-center justify-between">
        <ModalTitle>{row ? "Edit Category" : "New Category"}</ModalTitle>
        <ModalCloseButton />
      </div>

      {/* Live preview */}
      <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={{ backgroundColor: pickerColor }}
        >
          {previewImage ? (
            <img src={previewImage} alt="" className="h-7 w-7 object-contain" />
          ) : (
            <Layers className="size-4 text-white" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{form.name || "Category name"}</p>
          <p className="text-[11px] text-foreground/50">Preview in the Layer panel</p>
        </div>
      </div>

      <div>
        <InputLabel htmlFor="category_name" value="Name" />
        <TextInput
          id="category_name"
          name="name"
          type="text"
          required
          maxLength={100}
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          isError={Boolean(errors.name)}
        />
        <InputError messages={errors.name} className="mt-1" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <InputLabel htmlFor="category_color" value="Color" />
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="category_color_picker"
              value={pickerColor}
              onChange={(event) => setColor(event.target.value)}
              className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-transparent p-1"
              aria-label="Pick color"
            />
            <TextInput
              id="category_color"
              name="color"
              type="text"
              required
              maxLength={7}
              pattern="#[0-9a-fA-F]{6}"
              className="font-mono"
              value={form.color}
              onChange={(event) => setColor(event.target.value)}
              isError={Boolean(errors.color)}
            />
          </div>
          <InputError messages={errors.color} className="mt-1" />
        </div>
        <div>
          <InputLabel htmlFor="category_sort_order" value="Sort Order" />
          <TextInput
            id="category_sort_order"
            name="sort_order"
            type="number"
            min={0}
            max={9999}
            value={form.sortOrder}
            onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
            isError={Boolean(errors.sort_order)}
          />
          <InputError messages={errors.sort_order} className="mt-1" />
        </div>
      </div>

      <div>
        <InputLabel htmlFor="category_description" value="Description (optional)" />
        <textarea
          id="category_description"
          name="description"
          rows={2}
          maxLength={200}
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          className="w-full rounded-[0.625rem] border-[1.5px] border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        ></textarea>
        <InputError messages={errors.description} className="mt-1" />
      </div>

      <div>
        <InputLabel htmlFor="category_icon" value="Icon (optional, PNG/WebP, max 512 KB)" />
        <input
          type="file"
          id="category_icon"
          name="icon"
          accept="image/png,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            setFilePreview(file ? URL.createObjectURL(file) : null);
          }}
          className="w-full text-sm text-foreground/70 file:me-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground hover:file:bg-muted/70"
        />
        <InputError messages={errors.icon} className="mt-1" />
        {existingIconUrl ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-foreground/70">
            <input
              type="checkbox"
              name="remove_icon"
              value="1"
              id="category_remove_icon"
              className="accent-error"
              checked={removeIcon}
              onChange={(event) => setRemoveIcon(event.target.checked)}
            />{" "}
            Remove current icon
          </label>
        ) : null}
        <InputError messages={errors.remove_icon} className="mt-1" />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <ButtonLight type="button" onClick={onDone}>
          Cancel
        </ButtonLight>
        <ButtonPrimary type="submit" disabled={saving}>
          {saving ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}{" "}
          Save
        </ButtonPrimary>
      </div>
    </form>
  );
}
