"use client";

import { iconSvg } from "@/lib/icons";
import { Archive, ArchiveRestore, Database, Eye, LoaderCircle, Mountain, Pencil, Save, Shapes, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";

import { GENERIC_ERROR, rethrowNavigationError } from "@/components/app/action-helpers";
import { ButtonLight, ButtonPrimary } from "@/components/app/buttons";
import { EmptyState } from "@/components/app/empty-state";
import { InputError, InputLabel, SelectInput, TextInput } from "@/components/app/form-fields";
import { Modal, ModalCloseButton, ModalTitle } from "@/components/app/modal";
import { confirmPopup, DANGER_ICON } from "@/lib/client/popup-alert";
import { toast } from "@/lib/client/toast";
import { cn } from "@/lib/utils";
import type { FieldErrors } from "@/server/dashboard/validation";
import { createRecordDialogStore } from "@/stores/record-dialog-store";
import { createScopedStore } from "@/stores/scoped-store";

import {
  archiveLayerAction,
  getLayerDetailAction,
  restoreLayerAction,
  updateLayerAction,
  type LayerDetail,
} from "./actions";

export type LayerRow = {
  id: string;
  name: string;
  isTerrain: boolean;
  typeLabel: string;
  status: string;
  statusLabel: string;
  categoryName: string;
  categoryColor: string;
  size: string;
  uploader: string;
  createdAgo: string;
  createdTitle: string;
  edit: { name: string; layer_category_id: string; acquisition_date: string };
};

const STATUS_STYLES: Record<string, string> = {
  published: "bg-success/10 text-success",
  processing: "bg-primary/10 text-primary",
  queued: "bg-primary/10 text-primary",
  pending: "bg-muted text-foreground/60",
  process_failed: "bg-error/10 text-error",
  archived: "bg-secondary/20 text-foreground/70",
};

const ICON_BUTTON = "rounded-md p-1.5 text-foreground/60 disabled:opacity-40";

/** Archive icon of the confirmation popup (static SVG markup; the popup takes HTML). */
function archiveIconSvg(): string {
  return iconSvg("archive", { className: "mx-auto text-5xl text-warning" });
}

function safeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#6b7280";
}

/** The layer whose "detail" or "edit" modal is open, shared by the row buttons and both modals. */
const [LayerDialogProvider, useLayerDialog] = createScopedStore("LayerDialog", () =>
  createRecordDialogStore<"detail" | "edit", LayerRow>(),
);

/** Table, "View" and "Edit" modals and row actions of the Layer Management page. */
export function LayersTable({
  rows,
  categories,
  today,
  emptyMessage,
}: {
  rows: LayerRow[];
  categories: Array<{ id: string; name: string }>;
  today: string;
  emptyMessage: string;
}) {
  return (
    <LayerDialogProvider>
      <LayerRows rows={rows} emptyMessage={emptyMessage} />
      <LayerDetailModal />
      <LayerEditModal categories={categories} today={today} />
    </LayerDialogProvider>
  );
}

function LayerRows({ rows, emptyMessage }: { rows: LayerRow[]; emptyMessage: string }) {
  const router = useRouter();
  const openDialog = useLayerDialog((state) => state.openDialog);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function archive(row: LayerRow) {
    const confirmed = await confirmPopup({
      message: `Archive "${row.name}"? It will be hidden from the map.`,
      icon: archiveIconSvg(),
      confirmText: "OK",
      cancelText: "Cancel",
    });
    if (confirmed) runRowAction(row, () => archiveLayerAction(row.id));
  }

  function runRowAction(row: LayerRow, action: () => Promise<{ ok: boolean; message?: string }>) {
    setBusyId(row.id);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) toast.success(result.message);
        else toast.error(result.message ?? GENERIC_ERROR);
      } catch (error) {
        rethrowNavigationError(error);
        toast.error(GENERIC_ERROR);
      } finally {
        setBusyId(null);
      }
    });
  }

  async function remove(row: LayerRow) {
    const confirmed = await confirmPopup({
      message: `Delete layer "${row.name}" and all of its processed files? This cannot be undone.`,
      icon: DANGER_ICON,
      confirmText: "OK",
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    setBusyId(row.id);
    try {
      const response = await fetch(`/geodata/layers/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string };
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to delete the layer.");
      toast.success(`Layer "${row.name}" deleted.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete the layer.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-muted/50 text-[11px] font-bold uppercase tracking-wider text-foreground/60">
          <tr>
            <th className="px-4 py-3">Layer</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Size</th>
            <th className="px-4 py-3">Uploaded</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length > 0 ? (
            rows.map((row) => {
              const busy = busyId === row.id;
              return (
                <tr key={row.id} className="hover:bg-muted/30" data-layer-row={row.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70"
                        title={row.typeLabel}
                      >
                        {row.isTerrain ? (
                          <Mountain className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Shapes className="size-3.5" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-xs truncate font-semibold text-foreground">{row.name}</p>
                        <p className="font-mono text-[10px] text-foreground/50">{row.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: safeColor(row.categoryColor) }}></span>
                      {row.categoryName}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(STATUS_STYLES[row.status] ?? "bg-muted", "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase")}
                    >
                      {row.statusLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground/70">{row.size}</td>
                  <td className="px-4 py-3 text-xs">
                    <p className="text-foreground/80">{row.uploader}</p>
                    <p className="text-foreground/50" title={row.createdTitle}>
                      {row.createdAgo}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className={cn(ICON_BUTTON, "hover:bg-primary/10 hover:text-primary")}
                        title="View details"
                        aria-label={`View details of ${row.name}`}
                        onClick={() => openDialog("detail", row)}
                      >
                        <Eye className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={cn(ICON_BUTTON, "hover:bg-primary/10 hover:text-primary")}
                        title="Edit"
                        aria-label={`Edit ${row.name}`}
                        onClick={() => openDialog("edit", row)}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      {row.status === "published" ? (
                        <button
                          type="button"
                          className={cn(ICON_BUTTON, "hover:bg-warning/15 hover:text-warning")}
                          title="Archive (hide from map)"
                          aria-label={`Archive ${row.name}`}
                          disabled={busy}
                          onClick={() => archive(row)}
                        >
                          <Archive className="size-4" aria-hidden="true" />
                        </button>
                      ) : row.status === "archived" ? (
                        <button
                          type="button"
                          className={cn(ICON_BUTTON, "hover:bg-success/15 hover:text-success")}
                          title="Restore to map"
                          aria-label={`Restore ${row.name}`}
                          disabled={busy}
                          onClick={() => runRowAction(row, () => restoreLayerAction(row.id))}
                        >
                          <ArchiveRestore className="size-4" aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={cn(ICON_BUTTON, "hover:bg-error/10 hover:text-error")}
                        title="Delete"
                        aria-label={`Delete ${row.name}`}
                        disabled={busy}
                        onClick={() => remove(row)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={6}>
                <EmptyState icon={Database} iconClass="size-7.5" message={emptyMessage} containerClass="py-12" />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LayerDetailModal() {
  const open = useLayerDialog((state) => state.kind === "detail");
  const row = useLayerDialog((state) => state.row);
  const session = useLayerDialog((state) => state.session);
  const closeDialog = useLayerDialog((state) => state.closeDialog);

  return (
    <Modal open={open} onOpenChange={(next) => next || closeDialog()} maxWidth="2xl">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <ModalTitle>Layer Details</ModalTitle>
        <ModalCloseButton />
      </div>
      <div className="p-6">{row ? <LayerDetailLoader key={session} id={row.id} /> : null}</div>
    </Modal>
  );
}

/** Loads the layer's details when the modal opens (remounted for every opening). */
function LayerDetailLoader({ id }: { id: string }) {
  const [detail, setDetail] = useState<LayerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    startTransition(async () => {
      try {
        const result = await getLayerDetailAction(id);
        if (!current) return;
        if (result.ok) setDetail(result.detail);
        else setError(result.message);
      } catch (caught) {
        rethrowNavigationError(caught);
        if (current) setError("Failed to load layer details.");
      }
    });
    return () => {
      current = false;
    };
  }, [id]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (detail) return <LayerDetailBody detail={detail} />;
  return (
    <div className="py-10 text-center text-foreground/50" role="status">
      <LoaderCircle className="inline-block size-6 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

function LayerEditModal({ categories, today }: { categories: Array<{ id: string; name: string }>; today: string }) {
  const open = useLayerDialog((state) => state.kind === "edit");
  const row = useLayerDialog((state) => state.row);
  const session = useLayerDialog((state) => state.session);
  const closeDialog = useLayerDialog((state) => state.closeDialog);

  return (
    <Modal open={open} onOpenChange={(next) => next || closeDialog()} maxWidth="lg">
      {row ? <LayerEditForm key={session} row={row} categories={categories} today={today} onDone={closeDialog} /> : null}
    </Modal>
  );
}

function LayerEditForm({
  row,
  categories,
  today,
  onDone,
}: {
  row: LayerRow;
  categories: Array<{ id: string; name: string }>;
  today: string;
  onDone: () => void;
}) {
  const [values, setValues] = useState(row.edit);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, startSaving] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = row.id;

    startSaving(async () => {
      try {
        const result = await updateLayerAction(id, data);
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

  return (
    <form className="space-y-4 p-6" onSubmit={submit}>
      <div className="flex items-center justify-between">
        <ModalTitle>Edit Layer</ModalTitle>
        <ModalCloseButton />
      </div>

      <div>
        <InputLabel htmlFor="layer_name" value="Name" />
        <TextInput
          id="layer_name"
          name="name"
          type="text"
          required
          maxLength={255}
          value={values.name}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
          isError={Boolean(errors.name)}
        />
        <InputError messages={errors.name} className="mt-1" />
      </div>
      <div>
        <InputLabel htmlFor="layer_category_id" value="Category" />
        <SelectInput
          id="layer_category_id"
          name="layer_category_id"
          className="w-full"
          value={values.layer_category_id}
          onChange={(event) => setValues((current) => ({ ...current, layer_category_id: event.target.value }))}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </SelectInput>
        <InputError messages={errors.layer_category_id} className="mt-1" />
      </div>
      <div>
        <InputLabel htmlFor="acquisition_date" value="Acquisition Date" />
        <TextInput
          id="acquisition_date"
          name="acquisition_date"
          type="date"
          max={today}
          value={values.acquisition_date}
          onChange={(event) => setValues((current) => ({ ...current, acquisition_date: event.target.value }))}
          isError={Boolean(errors.acquisition_date)}
        />
        <InputError messages={errors.acquisition_date} className="mt-1" />
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

/** Port of pages/dashboard/layers/partials/detail.blade.php. */
function LayerDetailBody({ detail }: { detail: LayerDetail }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-lg font-bold text-foreground">{detail.name}</p>
        <p className="font-mono text-[11px] text-foreground/50">{detail.id}</p>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {detail.rows.map(([label, value]) => (
          <div key={label} className="border-b border-border/60 pb-2">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-foreground/50">{label}</dt>
            <dd className="break-words text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {detail.bbox ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-foreground/50">Bounding box (WGS84)</p>
          <p className="rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground/80">{detail.bbox}</p>
        </div>
      ) : null}

      {detail.errorMessage ? (
        <div className="rounded-lg border border-error/30 bg-error/5 p-3">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-error">Last conversion error</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground/80">{detail.errorMessage}</pre>
        </div>
      ) : null}

      {detail.lastRun ? <p className="text-xs text-foreground/50">{detail.lastRun}</p> : null}
    </div>
  );
}
