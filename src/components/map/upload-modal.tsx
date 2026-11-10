"use client";

import {
  Calendar,
  File as FileIcon,
  FileUp,
  Image as ImageIcon,
  MapPinned,
  Mountain,
  Shapes,
  Tag,
  Type,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";

import { mapStore, useMapStore, type UploadKind } from "@/stores/map-store";

import { ButtonLight, ButtonPrimary, InputLabel, Modal, RadioCard, TextInput } from "./ui";

const FIELD_CLASS =
  "w-full rounded-xl border border-border bg-input px-4 py-2.5 text-sm transition-all focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 text-foreground";

const RASTER_ACCEPT = ".tif,.tiff,.geotiff";

const FILE_TYPES: Record<UploadKind, { accept: string; label: string }> = {
  terrain: { accept: RASTER_ACCEPT, label: "Supported: .TIF, .TIFF, .GEOTIFF" },
  vector: {
    accept: ".str,.zip,.dwg,.dxf,.geojson",
    label: "Supported: .STR, .ZIP (SHP), .DWG, .DXF, .GEOJSON",
  },
};

type LayerCategoryOption = { id: string | number; name: string; slug?: string };

/** .str, .dwg and .dxf files need a source CRS. */
function needsCrs(file: File | null): boolean {
  const name = file?.name.toLowerCase() ?? "";
  return name.endsWith(".str") || name.endsWith(".dwg") || name.endsWith(".dxf");
}

/**
 * Drop zone with a hidden file input (click to browse, or drop a file). The input is cleared after
 * every pick: the selected File lives in mapStore.uploadDraft.
 */
function DropZone({
  id,
  inputId,
  accept,
  className,
  onFile,
  children,
}: {
  id: string;
  inputId: string;
  accept: string;
  className: string;
  onFile: (file: File) => void;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      id={id}
      className={`${className}${dragging ? " border-primary bg-primary/5" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        id={inputId}
        className="hidden"
        accept={accept}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

/** File name chip with a remove button, shown inside a drop zone once a file is picked. */
function SelectedFile({
  id,
  removeId,
  file,
  onRemove,
  className,
  nameClassName,
}: {
  id: string;
  removeId: string;
  file: File | null;
  onRemove: () => void;
  className: string;
  nameClassName: string;
}) {
  return (
    <div id={id} className={`${className} ${file ? "flex" : "hidden"}`}>
      <FileIcon size="1em" aria-hidden="true" />
      <span className={nameClassName}>{file?.name ?? ""}</span>
      <button
        type="button"
        id={removeId}
        className="hover:text-error transition-colors"
        aria-label="Remove file"
        onClick={(event: MouseEvent) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <X size="1em" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Upload modal (port of x-upload-modal and its inline script). The form lives in
 * mapStore.uploadDraft; src/lib/map/map-page.js reads it when the form is submitted and runs the
 * upload. Opening and closing is handled by src/lib/map/ui-interactions.js ([data-modal]); closing
 * resets the form.
 */
export function UploadModal({
  maxUploadMb,
  utmEpsg,
  utmLabel,
}: {
  maxUploadMb: number;
  utmEpsg: string;
  utmLabel: string;
}) {
  const draft = useMapStore((state) => state.uploadDraft);
  const updateDraft = useMapStore((state) => state.updateUploadDraft);
  const resetDraft = useMapStore((state) => state.resetUploadDraft);
  const [categories, setCategories] = useState<LayerCategoryOption[] | null>(null);

  const crsOptions: Record<string, string> = {
    "EPSG:4326": "WGS 84 (EPSG:4326)",
    "EPSG:32749": "WGS 84 / UTM zone 49S (EPSG:32749)",
    "EPSG:32750": "WGS 84 / UTM zone 50S (EPSG:32750)",
    "EPSG:32751": "WGS 84 / UTM zone 51S (EPSG:32751)",
    "EPSG:32649": "WGS 84 / UTM zone 49N (EPSG:32649)",
    "EPSG:32650": "WGS 84 / UTM zone 50N (EPSG:32650)",
    "EPSG:32651": "WGS 84 / UTM zone 51N (EPSG:32651)",
  };
  if (!(utmEpsg in crsOptions)) {
    crsOptions[utmEpsg] = `WGS 84 / ${utmLabel} (${utmEpsg})`;
  }

  // Layer categories; "other" is preselected (Laravel: the "selected" option, else the first one).
  useEffect(() => {
    let cancelled = false;
    fetch("/geodata/layer-categories")
      .then((res) => res.json())
      .then((data: { success?: boolean; categories?: LayerCategoryOption[] }) => {
        if (cancelled || !data.success || !data.categories) return;
        setCategories(data.categories);
        if (!mapStore.getState().uploadDraft.categoryId) {
          const preselected =
            data.categories.find((category) => category.slug === "other") ?? data.categories[0];
          if (preselected) mapStore.getState().updateUploadDraft({ categoryId: String(preselected.id) });
        }
      })
      .catch((error) => console.error("Error loading layer categories:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  // Closing the modal (Cancel, backdrop, Escape, or after submitting) resets the form.
  useEffect(() => {
    const modal = document.getElementById("uploadModal");
    modal?.addEventListener("modal:closed", resetDraft);
    return () => modal?.removeEventListener("modal:closed", resetDraft);
  }, [resetDraft]);

  /** Size and extension check (alerts like the Laravel modal). */
  const acceptFile = (file: File, accept: string, invalidTypeMessage: string): boolean => {
    if (file.size < 1 || file.size > maxUploadMb * 1024 * 1024) {
      alert(`File is empty or exceeds the ${maxUploadMb} MiB upload limit.`);
      return false;
    }
    const extension = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!accept.split(",").includes(extension)) {
      alert(invalidTypeMessage);
      return false;
    }
    return true;
  };

  const { dataType, file, demFile, orthoFile } = draft;
  const vectorConfig = FILE_TYPES.vector;
  const showCrs = dataType === "vector" && needsCrs(file);
  const canSubmit =
    dataType === "terrain" ? Boolean(demFile) : Boolean(file) && (!needsCrs(file) || Boolean(draft.sourceEpsg));

  const chipClass = "items-center gap-2 rounded-full bg-primary/10 font-bold text-primary";

  return (
    <Modal name="upload" maxWidth="lg" id="uploadModal">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 id="uploadModalLabel" className="text-xl font-bold text-primary">
              Upload New Asset
            </h3>
            <p className="text-xs text-foreground/60">
              Configure your data before uploading to the map
            </p>
          </div>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted text-foreground/70 hover:text-error transition-all"
            data-modal-close=""
            aria-label="Close"
          >
            <X size="1em" className="text-2xl" aria-hidden="true" />
          </button>
        </div>

        {/* Submitted by src/lib/map/map-page.js (it reads mapStore.uploadDraft). */}
        <form id="uploadForm" className="space-y-6" onSubmit={(event) => event.preventDefault()}>
          {/* Data Type Selection */}
          <div>
            <InputLabel htmlFor="data_type" value="Data Type" />
            <div className="grid grid-cols-2 gap-3">
              <RadioCard
                name="dataType"
                value="terrain"
                icon={Mountain}
                title="Terrain"
                description="Topography data"
                checked={dataType === "terrain"}
                onChange={() => {
                  updateDraft({ dataType: "terrain" });
                  resetDraft();
                }}
              />
              <RadioCard
                name="dataType"
                value="vector"
                icon={Shapes}
                title="Vector"
                description="Points, lines, polygons"
                checked={dataType === "vector"}
                onChange={() => {
                  updateDraft({ dataType: "vector" });
                  resetDraft();
                }}
              />
            </div>
          </div>

          {/* Metadata Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <InputLabel htmlFor="layerName" value="Layer Name" icon={Type} />
              <TextInput
                id="layerName"
                name="layerName"
                placeholder="Enter layer name"
                value={draft.layerName}
                onChange={(event) => updateDraft({ layerName: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <InputLabel htmlFor="acquisitionDate" value="Acquisition Date" icon={Calendar} />
              <input
                type="date"
                id="acquisitionDate"
                name="acquisitionDate"
                className={FIELD_CLASS}
                value={draft.acquisitionDate}
                onChange={(event) => updateDraft({ acquisitionDate: event.target.value })}
              />
            </div>
          </div>

          {/* Category Selection */}
          <div
            id="layerCategorySelectWrapper"
            className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300"
          >
            <InputLabel htmlFor="layerCategorySelect" value="Category" icon={Tag} />
            <select
              id="layerCategorySelect"
              name="layerCategorySelect"
              className={FIELD_CLASS}
              value={draft.categoryId}
              onChange={(event) => updateDraft({ categoryId: event.target.value })}
            >
              {categories ? (
                categories.map((category) => (
                  <option key={category.id} value={String(category.id)}>
                    {category.name}
                  </option>
                ))
              ) : (
                <option value="">Loading categories...</option>
              )}
            </select>
          </div>

          {/* CRS Selection (Shown for STR files) */}
          <div
            id="crsSelectionContainer"
            className={`${showCrs ? "" : "hidden "}space-y-2 animate-in fade-in slide-in-from-top-2 duration-300`}
          >
            <InputLabel htmlFor="sourceEpsg" value="Source CRS (EPSG)" icon={MapPinned} />
            <select
              id="sourceEpsg"
              name="sourceEpsg"
              className={FIELD_CLASS}
              value={draft.sourceEpsg}
              onChange={(event) => updateDraft({ sourceEpsg: event.target.value })}
            >
              <option value="">-- Select CRS --</option>
              {Object.entries(crsOptions).map(([code, name]) => (
                <option key={code} value={code}>
                  {`${name}${code === utmEpsg ? " (Project Default)" : ""}`}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-foreground/50">
              Required for .STR, .DWG, and .DXF files to ensure correct reprojection.
            </p>
          </div>

          {/* File Selection */}
          <div id="fileSelectionContainer">
            {/* Standard Single File Selection */}
            <div id="singleFileUploadSection" className={dataType === "terrain" ? "hidden" : undefined}>
              <InputLabel htmlFor="file" value="File (Required)" icon={FileUp} />
              <DropZone
                id="modalDropZone"
                inputId="modalFileInput"
                accept={vectorConfig.accept}
                className="group flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-10 text-center transition-all hover:border-primary/50 hover:bg-primary/2 cursor-pointer"
                onFile={(picked) => {
                  if (!acceptFile(picked, vectorConfig.accept, `Invalid file type. Please upload: ${vectorConfig.accept}`)) return;
                  updateDraft({ file: picked });
                }}
              >
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-neutral shadow-inner transition-transform group-hover:scale-110">
                  <FileUp size="1em" className="text-3xl text-primary" aria-hidden="true" />
                </div>
                <p className="text-sm font-bold text-foreground">
                  Drag and drop or <span className="text-primary underline">browse files</span>
                </p>
                <p className="text-[10px] font-medium text-foreground/50 mt-1 uppercase tracking-wider">
                  Max size {maxUploadMb} MB
                </p>
                <p
                  id="supportedFormats"
                  className="text-[9px] font-bold text-primary/70 mt-1 truncate max-w-[80%] uppercase tracking-tighter"
                >
                  {vectorConfig.label}
                </p>
                <SelectedFile
                  id="fileNameDisplay"
                  removeId="removeFileBtn"
                  file={file}
                  onRemove={() => updateDraft({ file: null })}
                  className={`mt-4 px-4 py-1.5 text-xs ${chipClass}`}
                  nameClassName="truncate max-w-[200px]"
                />
              </DropZone>
            </div>

            {/* Terrain Specific Double File Selection */}
            <div
              id="terrainFileUploadSection"
              className={dataType === "terrain" ? "space-y-4" : "hidden space-y-4"}
            >
              {/* DEM Field */}
              <div>
                <label
                  className="mb-2 block text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider"
                >
                  <Mountain size="1em" className="text-primary" aria-hidden="true" />
                  DEM File (Required)
                </label>
                <DropZone
                  id="demDropZone"
                  inputId="demFileInput"
                  accept={RASTER_ACCEPT}
                  className="group flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-6 text-center transition-all hover:border-primary/50 hover:bg-primary/2 cursor-pointer"
                  onFile={(picked) => {
                    if (!acceptFile(picked, RASTER_ACCEPT, "Invalid DEM file. Please upload: .tif, .tiff, .geotiff")) return;
                    updateDraft({ demFile: picked });
                  }}
                >
                  <FileUp size="1em" className="text-2xl text-primary mb-1" aria-hidden="true" />
                  <p className="text-[11px] font-bold text-foreground">Click or drop DEM file</p>
                  <p className="text-[9px] text-foreground/50">.TIF, .TIFF, .GEOTIFF</p>
                  <SelectedFile
                    id="demNameDisplay"
                    removeId="removeDemBtn"
                    file={demFile}
                    onRemove={() => updateDraft({ demFile: null })}
                    className={`mt-2 px-3 py-1 text-[10px] ${chipClass}`}
                    nameClassName="truncate max-w-[150px]"
                  />
                </DropZone>
              </div>

              {/* Orthophoto Field */}
              <div>
                <label
                  className="mb-2 block text-xs font-bold text-foreground flex items-center gap-2 uppercase tracking-wider"
                >
                  <ImageIcon size="1em" className="text-primary" aria-hidden="true" />
                  Orthophoto (Optional)
                </label>
                <DropZone
                  id="orthoDropZone"
                  inputId="orthoFileInput"
                  accept={RASTER_ACCEPT}
                  className="group flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-6 text-center transition-all hover:border-primary/50 hover:bg-primary/2 cursor-pointer"
                  onFile={(picked) => {
                    if (!acceptFile(picked, RASTER_ACCEPT, "Invalid Orthophoto. Please upload: .tif, .tiff, .geotiff")) return;
                    updateDraft({ orthoFile: picked });
                  }}
                >
                  <FileUp size="1em" className="text-2xl text-primary mb-1" aria-hidden="true" />
                  <p className="text-[11px] font-bold text-foreground">Click or drop Orthophoto</p>
                  <p className="text-[9px] text-foreground/50">.TIF, .TIFF, .GEOTIFF</p>
                  <SelectedFile
                    id="orthoNameDisplay"
                    removeId="removeOrthoBtn"
                    file={orthoFile}
                    onRemove={() => updateDraft({ orthoFile: null })}
                    className={`mt-2 px-3 py-1 text-[10px] ${chipClass}`}
                    nameClassName="truncate max-w-[150px]"
                  />
                </DropZone>
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <ButtonLight type="button" className="flex-1" data-modal-close="">
              Cancel
            </ButtonLight>
            <ButtonPrimary type="submit" id="submitUploadBtn" className="flex-1" disabled={!canSubmit}>
              Start Upload
            </ButtonPrimary>
          </div>
        </form>
      </div>
    </Modal>
  );
}
