import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/**
 * Client state of the 3D map page, shared by the React chrome (src/components/map) and the
 * imperative engine (src/lib/map). One source of truth instead of window globals and DOM classes:
 *
 * - React renders from it with `useMapStore(selector)` (side panels, nav buttons, upload badge,
 *   account menu, layer filters, upload modal).
 * - The engine reads and writes it with `mapStore.getState()` / `setState()` and reacts to changes
 *   with `mapStore.subscribe()` (fetching the layer list, recent uploads, layer toggle icons).
 *
 * Runtime objects stay with their owners: Cesium primitives on CesiumMapController, upload
 * AbortControllers and resume sessions in src/lib/map/map-page.js. src/lib/map/mount.js resets
 * the store when the map unmounts, so navigating away and back starts clean.
 */

export type MapPanel = "layers" | "data";

export type MapSession = {
  role: string;
  /** Admins upload geodata (Data panel, upload modal). */
  canUpload: boolean;
};

export type LayerFilters = {
  search: string;
  /** "YYYY-MM" from the month input, or "". */
  monthYear: string;
};

export type CatalogTerrainDetail = {
  tileset_url?: string | null;
  acquisition_date?: string | null;
  native_bounding_box?: Record<string, number> | null;
  has_ortho?: boolean;
  has_ortho_tiles?: boolean;
  ortho_tiles_url?: string | null;
  ortho_min_zoom?: number | null;
  ortho_max_zoom?: number | null;
};

export type CatalogVectorDetail = {
  acquisition_date?: string | null;
  native_bounding_box?: Record<string, number> | null;
};

/** A published layer as returned by GET /geodata/layers/all. */
export type CatalogLayer = {
  id: string | number;
  name: string;
  layer_type: string;
  created_at?: string;
  terrain_detail?: CatalogTerrainDetail | null;
  vector_detail?: CatalogVectorDetail | null;
};

export type CatalogCategory = {
  id: string | number;
  name: string;
  slug?: string;
  color?: string | null;
  icon_url?: string | null;
  layers: CatalogLayer[];
};

export type LayerCatalog = {
  status: "idle" | "loading" | "ready" | "error";
  categories: CatalogCategory[];
  /** The filters `categories` were loaded with (the empty-state text depends on them). */
  filters: LayerFilters;
};

export type UploadKind = "terrain" | "vector";

export type UploadStatus = "uploading" | "processing" | "done" | "failed";

/** An upload card in the Data panel, from submission until the card is removed. */
export type UploadEntry = {
  id: string;
  name: string;
  type: UploadKind;
  status: UploadStatus;
};

/** The upload modal form. */
export type UploadDraft = {
  dataType: UploadKind;
  layerName: string;
  acquisitionDate: string;
  /** Layer category id ("" until the categories are loaded). */
  categoryId: string;
  /** Source CRS of .str / .dwg / .dxf files. */
  sourceEpsg: string;
  /** Vector file. */
  file: File | null;
  /** Terrain DEM (required) and orthophoto (optional). */
  demFile: File | null;
  orthoFile: File | null;
};

export type MapStateData = {
  session: MapSession;
  /** Side panel shown in the shared slot (md+) / bottom sheet (phones). */
  activePanel: MapPanel | null;
  userMenuOpen: boolean;

  layerFilters: LayerFilters;
  layerCatalog: LayerCatalog;
  /** Bumped by the refresh button: the engine shows the skeleton and reloads the layer list. */
  layersRefreshRequest: number;

  /** Layer id of the terrain on the globe (CesiumMapController#loadedTerrainId). */
  activeTerrainId: string | null;
  /** Vector layers currently shown on the globe. */
  visibleVectorIds: string[];
  /** Layers whose show/hide request is running (their toggle shows a spinner). */
  pendingLayerIds: string[];

  uploads: UploadEntry[];
  /** Bumped to reload the "Recent uploads" list. */
  recentUploadsRequest: number;

  uploadDraft: UploadDraft;
};

export type MapActions = {
  togglePanel: (panel: MapPanel) => void;
  /** Opens a panel; no-op when it is already open (the side panels share one slot). */
  showPanel: (panel: MapPanel) => void;
  closePanels: () => void;
  setUserMenuOpen: (open: boolean) => void;

  setLayerFilters: (patch: Partial<LayerFilters>) => void;
  refreshLayers: () => void;
  setLayerPending: (layerId: string, pending: boolean) => void;

  addUpload: (upload: UploadEntry) => void;
  updateUpload: (id: string, patch: Partial<Omit<UploadEntry, "id">>) => void;
  removeUpload: (id: string) => void;
  refreshRecentUploads: () => void;

  updateUploadDraft: (patch: Partial<UploadDraft>) => void;
  /** Clears the files and text fields; keeps the data type and the category (as the Laravel form did). */
  resetUploadDraft: () => void;

  /** Back to the initial state (map unmount). */
  reset: () => void;
};

export type MapState = MapStateData & MapActions;

const EMPTY_FILTERS: LayerFilters = { search: "", monthYear: "" };

function emptyUploadDraft(): UploadDraft {
  return {
    dataType: "terrain",
    layerName: "",
    acquisitionDate: "",
    categoryId: "",
    sourceEpsg: "",
    file: null,
    demFile: null,
    orthoFile: null,
  };
}

function initialState(): MapStateData {
  return {
    session: { role: "", canUpload: false },
    activePanel: null,
    userMenuOpen: false,
    layerFilters: { ...EMPTY_FILTERS },
    layerCatalog: { status: "idle", categories: [], filters: { ...EMPTY_FILTERS } },
    layersRefreshRequest: 0,
    activeTerrainId: null,
    visibleVectorIds: [],
    pendingLayerIds: [],
    uploads: [],
    recentUploadsRequest: 0,
    uploadDraft: emptyUploadDraft(),
  };
}

export const mapStore = createStore<MapState>()((set, get) => ({
  ...initialState(),

  // Every panel change also closes the account menu (Laravel closeAllPanels()).
  togglePanel: (panel) =>
    set((state) => ({
      activePanel: state.activePanel === panel ? null : panel,
      userMenuOpen: false,
    })),
  showPanel: (panel) => {
    if (get().activePanel !== panel) set({ activePanel: panel, userMenuOpen: false });
  },
  closePanels: () => set({ activePanel: null, userMenuOpen: false }),
  setUserMenuOpen: (open) => set({ userMenuOpen: open }),

  setLayerFilters: (patch) => set((state) => ({ layerFilters: { ...state.layerFilters, ...patch } })),
  refreshLayers: () => set((state) => ({ layersRefreshRequest: state.layersRefreshRequest + 1 })),
  setLayerPending: (layerId, pending) =>
    set((state) => {
      const has = state.pendingLayerIds.includes(layerId);
      if (has === pending) return state;
      return {
        pendingLayerIds: pending
          ? [...state.pendingLayerIds, layerId]
          : state.pendingLayerIds.filter((id) => id !== layerId),
      };
    }),

  addUpload: (upload) =>
    set((state) => ({ uploads: [upload, ...state.uploads.filter((item) => item.id !== upload.id)] })),
  updateUpload: (id, patch) =>
    set((state) => ({
      uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
  removeUpload: (id) =>
    set((state) => ({ uploads: state.uploads.filter((item) => item.id !== id) })),
  refreshRecentUploads: () =>
    set((state) => ({ recentUploadsRequest: state.recentUploadsRequest + 1 })),

  updateUploadDraft: (patch) => set((state) => ({ uploadDraft: { ...state.uploadDraft, ...patch } })),
  resetUploadDraft: () =>
    set((state) => ({
      uploadDraft: {
        ...emptyUploadDraft(),
        dataType: state.uploadDraft.dataType,
        categoryId: state.uploadDraft.categoryId,
      },
    })),

  reset: () => set(initialState()),
}));

/** Resets the map store (called when the map page unmounts). */
export function resetMapStore(): void {
  mapStore.getState().reset();
}

/** React access to the map store. Select primitives or stable references (no new objects). */
export function useMapStore<T>(selector: (state: MapState) => T): T {
  return useStore(mapStore, selector);
}
