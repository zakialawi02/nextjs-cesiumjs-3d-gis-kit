"use client";

import { Calendar, Check, CircleAlert, Copy, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

import { useMapStore, type MapPanel } from "@/stores/map-store";

import { ButtonClose } from "./ui";

/**
 * Small client components of the map chrome. Shared state comes from the map store
 * (src/stores/map-store.ts), which the imperative scripts in src/lib/map read and write too.
 */

/** A side panel (Layers / Data); `.panel-open` follows mapStore.activePanel. */
export function SidePanel({
  panel,
  labelledBy,
  children,
}: {
  panel: MapPanel;
  labelledBy: string;
  children: ReactNode;
}) {
  const open = useMapStore((state) => state.activePanel === panel);
  return (
    <section
      id={`${panel}Panel`}
      className={open ? "map-panel map-sheet panel-open" : "map-panel map-sheet"}
      aria-labelledby={labelledBy}
    >
      {children}
    </section>
  );
}

/** Close button of a side panel. */
export function PanelCloseButton({ id, label }: { id: string; label: string }) {
  const closePanels = useMapStore((state) => state.closePanels);
  return <ButtonClose id={id} aria-label={label} onClick={closePanels} />;
}

/**
 * Search, month filter and refresh of the Layers panel. They write mapStore.layerFilters /
 * layersRefreshRequest; src/lib/map/map-page.js reloads the list (debounced) when they change.
 */
export function LayerFilterControls() {
  const search = useMapStore((state) => state.layerFilters.search);
  const monthYear = useMapStore((state) => state.layerFilters.monthYear);
  const setLayerFilters = useMapStore((state) => state.setLayerFilters);
  const refreshLayers = useMapStore((state) => state.refreshLayers);
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(spinTimer.current), []);

  const refresh = () => {
    setSpinning(true);
    window.clearTimeout(spinTimer.current);
    spinTimer.current = window.setTimeout(() => setSpinning(false), 600);
    refreshLayers();
  };

  return (
    <div className="flex flex-none flex-col gap-2 px-3 pb-3">
      <label className="relative block">
        <span className="sr-only">Search layers</span>
        <Search size="1em" className="map-field-icon" aria-hidden="true" />
        <input
          type="search"
          id="searchLayers"
          placeholder="Search layers"
          autoComplete="off"
          spellCheck={false}
          className="map-field pl-9"
          value={search}
          onChange={(event) => setLayerFilters({ search: event.target.value })}
        />
      </label>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Calendar size="1em" className="map-field-icon" aria-hidden="true" />
          <input
            type="month"
            id="filterMonthYearLayers"
            aria-label="Filter by acquisition or upload month"
            className="map-field cursor-pointer pl-9 pr-10"
            value={monthYear}
            onChange={(event) => setLayerFilters({ monthYear: event.target.value })}
          />
          <button
            type="button"
            id="clearMonthYearLayersFilter"
            className={`map-icon-btn absolute right-1 top-1/2 size-8 -translate-y-1/2 hover:text-map-danger${monthYear ? "" : " hidden"}`}
            aria-label="Clear month filter"
            onClick={() => setLayerFilters({ monthYear: "" })}
          >
            <X size="1em" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          id="refreshLayersBtn"
          className="map-icon-btn map-icon-btn--boxed"
          aria-label="Refresh layers"
          data-tip="Refresh layers"
          onClick={refresh}
        >
          <RefreshCw size="1em" className={spinning ? "animate-spin" : undefined} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** "Refresh" of the Recent uploads list (bumps mapStore.recentUploadsRequest). */
export function RecentUploadsRefreshButton() {
  const refreshRecentUploads = useMapStore((state) => state.refreshRecentUploads);
  return (
    <button
      type="button"
      id="refreshRecentUploadsBtn"
      className="map-link-btn"
      onClick={refreshRecentUploads}
    >
      <RefreshCw size="1em" aria-hidden="true" />
      <span>Refresh</span>
    </button>
  );
}

/** Empty state of the "In progress" list, hidden while mapStore.uploads has cards. */
export function ActiveUploadsEmpty({ children }: { children: ReactNode }) {
  const hasUploads = useMapStore((state) => state.uploads.length > 0);
  return (
    <div id="activeUploadsEmpty" className="map-empty" hidden={hasUploads}>
      {children}
    </div>
  );
}

type CopyStatus = "idle" | "copied" | "failed";

const COPY_STATES: Record<CopyStatus, { label: string; icon: ReactNode }> = {
  idle: { label: "Copy coordinates", icon: <Copy size="1em" aria-hidden="true" /> },
  copied: {
    label: "Coordinates copied",
    icon: <Check size="1em" className="text-map-success" aria-hidden="true" />,
  },
  failed: {
    label: "Copy failed",
    icon: <CircleAlert size="1em" className="text-map-danger" aria-hidden="true" />,
  },
};

function copyWithSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

/**
 * Copies the picked point ("lat, lon, z") from the coordinate card. The readouts are filled by
 * CesiumMapController (src/lib/map/cesium-map.js).
 */
export function CopyCoordinatesButton() {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    const read = (id: string) => (document.getElementById(id)?.textContent || "").trim();
    const parts = [read("pickLatVal"), read("pickLngVal")];
    const elevation = read("pickZVal").replace(/\s*m$/, "");
    if (elevation && elevation !== "-") parts.push(elevation);
    if (parts.some((part) => !part || part === "-")) return;

    const text = parts.join(", ");
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = copyWithSelection(text);
    }

    setStatus(copied ? "copied" : "failed");
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setStatus("idle"), 1500);
  };

  return (
    <button
      type="button"
      id="copyPickedCoordinatesBtn"
      className="map-icon-btn"
      aria-label={COPY_STATES[status].label}
      data-tip="Copy"
      onClick={copy}
    >
      {COPY_STATES[status].icon}
    </button>
  );
}

/**
 * Uncontrolled text input that keeps only digits, ".", "," and "-" while typing
 * (Laravel: oninput="this.value = this.value.replace(/[^0-9.,\-]/g, '');").
 * The analysis scripts read and write its value directly.
 */
export function DecimalInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "onInput" | "value">,
) {
  return (
    <input
      type="text"
      inputMode="decimal"
      {...props}
      onInput={(event) => {
        const input = event.currentTarget;
        input.value = input.value.replace(/[^0-9.,\-]/g, "");
      }}
    />
  );
}
