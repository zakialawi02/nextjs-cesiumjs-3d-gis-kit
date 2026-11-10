/**
 * HTML templates for the map lists, rendered from JSON in the browser (and once on the server for
 * the initial loading states). Ports of the Blade components that Laravel embedded in JavaScript
 * template literals: x-layer-card, x-accordion-group-data, x-upload-progress-card,
 * x-loading-spinner and x-skeleton. The markup (classes, data-* hooks) is the same, because
 * src/lib/map/cesium-map.js and the CSS in globals.css rely on it.
 *
 * Text values are escaped here; `dataAttrs` and `content` are trusted HTML built by the caller.
 */
import { escapeHtml, safeColor } from "@/lib/client/helpers";
import { iconNameOf, iconSvg, setIcon, type IconName } from "@/lib/icons";

/** x-loading-spinner */
export function loadingSpinner({
  id,
  message = "Loading...",
}: { id?: string; message?: string } = {}): string {
  return `<div class="flex items-center justify-center gap-2 py-6 text-xs text-map-subtle"${id ? ` id="${escapeHtml(id)}"` : ""} role="status">
    ${iconSvg("loader-circle", { className: "animate-spin text-base text-map-accent-ink" })}
    <span>${escapeHtml(message)}</span>
</div>`;
}

/** x-skeleton: loading placeholder shaped like the map layer cards. */
export function skeleton({ id, count = 3 }: { id?: string; count?: number } = {}): string {
  const card = `
    <div class="animate-pulse rounded-[0.875rem] border border-map-line p-2.5">
        <div class="flex items-start gap-3">
            <div class="size-9 shrink-0 rounded-[0.625rem] bg-map-hover"></div>
            <div class="min-w-0 flex-1 space-y-2 pt-1">
                <div class="h-3 w-2/3 rounded bg-map-hover"></div>
                <div class="h-2.5 w-1/2 rounded bg-map-hover"></div>
                <div class="h-2.5 w-3/4 rounded bg-map-hover"></div>
            </div>
            <div class="flex gap-1.5 pt-1">
                <div class="size-6 rounded-md bg-map-hover"></div>
                <div class="size-6 rounded-md bg-map-hover"></div>
            </div>
        </div>
    </div>`;

  return `<div${id ? ` id="${escapeHtml(id)}"` : ""} class="flex flex-col gap-1.5" aria-hidden="true">
    <div class="mb-1 h-4 w-32 animate-pulse rounded-md bg-map-hover"></div>${card.repeat(Math.max(0, count))}
</div>`;
}

/** Icon of each layer type (layer cards, upload cards, recent uploads). */
export const LAYER_TYPE_ICONS: Record<string, IconName> = {
  terrain: "mountain",
  vector: "shapes",
  imagery: "image",
  pointcloud: "chart-scatter",
};

export function layerTypeIcon(layerType: string): IconName {
  return LAYER_TYPE_ICONS[layerType] ?? "file";
}

/** What the show/hide button of a layer card shows. */
export type LayerToggleState = "visible" | "hidden" | "pending";

const LAYER_TOGGLE_ICONS: Record<LayerToggleState, { name: IconName; className: string }> = {
  visible: { name: "eye", className: "text-primary text-[15px]" },
  hidden: { name: "eye-off", className: "text-foreground/40 text-[15px]" },
  pending: { name: "loader-circle", className: "animate-spin text-primary text-[15px]" },
};

function layerToggleIcon(state: LayerToggleState): string {
  const { name, className } = LAYER_TOGGLE_ICONS[state];
  return iconSvg(name, { className });
}

/**
 * Shows `state` on a layer card's show/hide button (eye / eye-off / spinner). The card's
 * "visible" look follows the eye icon (`.map-layer:has(.map-layer-toggle [data-icon="eye"])`).
 */
export function setLayerToggleIcon(button: Element, state: LayerToggleState): void {
  const { name, className } = LAYER_TOGGLE_ICONS[state];
  const current = button.querySelector("[data-icon]");
  if (!current) {
    button.insertAdjacentHTML("afterbegin", iconSvg(name, { className }));
  } else if (iconNameOf(current) !== name) {
    setIcon(current, name, { className });
  }
}

export type LayerCardProps = {
  id: string;
  name: string;
  acquisitionDate?: string;
  createdAt?: string;
  /** Trusted attribute string (data-id, data-bbox, ...), built by the caller. */
  dataAttrs?: string;
  /** Trusted HTML inserted under the meta lines. */
  badges?: string;
  opacityClass?: string;
  layerType: string;
  isActive: boolean;
  /** A show/hide request is running for this layer (spinner on the toggle). */
  isPending?: boolean;
  actionDisabledClass?: string;
  categoryColor?: string | null;
};

/**
 * x-layer-card. Hooks used by cesium-map.js: .layer-card-item + data-* attributes,
 * .toggle-{type}-btn (its icon is swapped by setLayerToggleIcon()), .focus-{type}-btn,
 * .configure-vector-btn, .vector-settings-panel and .label-field-select. The card's "visible" look
 * follows the eye icon (see .map-layer in globals.css).
 */
export function layerCard({
  id,
  name,
  acquisitionDate = "N/A",
  createdAt = "N/A",
  dataAttrs = "",
  badges = "",
  opacityClass = "",
  layerType,
  isActive,
  isPending = false,
  actionDisabledClass = "",
}: LayerCardProps): string {
  const safeId = escapeHtml(id);
  const safeName = escapeHtml(name);
  const type = escapeHtml(layerType);
  const typeIcon = layerTypeIcon(layerType);
  const toggleState: LayerToggleState = isPending ? "pending" : isActive ? "visible" : "hidden";
  const configureHidden = layerType === "vector" ? (isActive ? "" : "hidden") : "hidden";

  return `<div class="layer-card-item map-layer ${opacityClass}" ${dataAttrs}>
    <div class="map-layer-row">
        <span class="map-layer-type map-layer-type--${type}" aria-hidden="true">
            ${iconSvg(typeIcon)}
        </span>

        <div class="map-layer-main">
            <h3 class="map-layer-name" title="${safeName}">${safeName}</h3>
            <p class="map-layer-meta">
                <span class="map-layer-meta-key">Acquired</span>
                <span>${escapeHtml(acquisitionDate)}</span>
            </p>
            <p class="map-layer-meta">
                <span class="map-layer-meta-key">Uploaded</span>
                <span>${escapeHtml(createdAt)}</span>
            </p>
            ${badges}
        </div>

        <div class="map-layer-actions">
            <button type="button"
                class="configure-vector-btn map-icon-btn ${actionDisabledClass} ${configureHidden}"
                title="Label settings" aria-label="Label settings" data-layer-id="${safeId}">
                ${iconSvg("tag", { className: "text-[15px]" })}
            </button>
            <button type="button" class="toggle-${type}-btn map-icon-btn map-layer-toggle ${actionDisabledClass}" title="Show / hide" aria-label="Show or hide layer">
                ${layerToggleIcon(toggleState)}
            </button>
            <button type="button" class="focus-${type}-btn map-icon-btn ${actionDisabledClass}" title="Zoom to layer" aria-label="Zoom to layer">
                ${iconSvg("locate-fixed", { className: "text-[15px]" })}
            </button>
        </div>
    </div>

    <p class="map-layer-id-row">
        <span class="map-layer-meta-key">ID</span>
        <span class="map-layer-id" title="ID: ${safeId}">${safeId}</span>
    </p>

    <div class="vector-settings-panel map-layer-settings hidden ${layerType === "vector" ? "" : "!hidden"}">
        <span class="map-label">Label field</span>
        <select class="label-field-select map-field" aria-label="Label field">
            <option value="">No label</option>
        </select>
    </div>
</div>`;
}

export type AccordionGroupProps = {
  id: string;
  title?: string;
  count?: number | string | null;
  /** Trusted HTML shown before the title. */
  icon?: string;
  /** Trusted HTML shown after the toggle button. */
  actions?: string;
  /** Trusted HTML of the group body. */
  content: string;
};

/** x-accordion-group-data. Toggled by ui-interactions.js (event delegation on [data-accordion-toggle]). */
export function accordionGroupData({
  id,
  title = "",
  count = null,
  icon = "",
  actions = "",
  content,
}: AccordionGroupProps): string {
  const safeId = escapeHtml(id);
  const countHtml =
    count !== null && count !== ""
      ? `\n            <span class="map-group-count">${escapeHtml(count)}</span>`
      : "";

  return `<div class="accordion-group is-open map-group" data-accordion id="accordion-group-${safeId}-heading">
    <div class="flex items-center gap-1">
        <button type="button" data-accordion-toggle class="accordion-toggle map-group-toggle" aria-expanded="true" aria-controls="accordion-group-${safeId}-content">
            ${iconSvg("chevron-right", { className: "accordion-chevron" })}
            ${icon}
            <span class="accordion-title min-w-0 truncate">${escapeHtml(title)}</span>${countHtml}
        </button>
        ${actions}
    </div>
    <div id="accordion-group-${safeId}-content" data-accordion-content class="map-group-body" aria-labelledby="accordion-group-${safeId}-heading">
        ${content}
    </div>
</div>`;
}

/** Category colour dot used as the accordion icon in the layers list. */
export function groupDot(color: unknown): string {
  return `<span class="map-group-dot" style="--dot: ${safeColor(color)}" aria-hidden="true"></span>`;
}

export type UploadProgressCardProps = {
  uploadId: string;
  fileName: string;
  type: string;
};

/**
 * x-upload-progress-card: an in-flight upload in the Data panel.
 * Hooks: .progress-*, .upload-controls, .pause-resume-btn, .cancel-upload-btn.
 */
export function uploadProgressCard({
  uploadId,
  fileName,
  type,
}: UploadProgressCardProps): string {
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return `<div id="${escapeHtml(uploadId)}" class="rounded-[0.875rem] border border-map-line bg-map-surface-strong p-3 transition-all">
    <div class="flex items-start gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-map-accent-soft text-map-accent-ink" aria-hidden="true">
            ${iconSvg(layerTypeIcon(type), { className: "text-lg" })}
        </span>
        <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <h4 class="truncate text-[0.8125rem] font-semibold text-map-ink">${escapeHtml(fileName)}</h4>
                    <p class="text-[0.6875rem] font-semibold uppercase tracking-wide text-map-subtle">${escapeHtml(typeLabel)}</p>
                </div>
                <div class="upload-controls -mr-1 -mt-1 flex shrink-0 items-center">
                    <button type="button" class="pause-resume-btn map-icon-btn size-8" title="Pause upload" aria-label="Pause or resume upload">
                        ${iconSvg("pause", { className: "text-sm" })}
                    </button>
                    <button type="button" class="cancel-upload-btn map-icon-btn size-8 hover:text-map-danger" title="Cancel upload" aria-label="Cancel upload">
                        ${iconSvg("x", { className: "text-sm" })}
                    </button>
                </div>
            </div>
        </div>
    </div>
    <div class="mt-2.5 flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2 text-[0.6875rem]">
            <span class="progress-label min-w-0 flex-1 truncate font-medium italic text-foreground/70">Uploading...</span>
            <span class="progress-percent shrink-0 font-semibold tabular-nums text-map-accent-ink">0%</span>
        </div>
        <div class="progress-container h-1.5 w-full overflow-hidden rounded-full bg-map-hover">
            <div class="progress-bar h-full w-0 rounded-full bg-map-accent transition-[width] duration-300"></div>
        </div>
    </div>
</div>`;
}
