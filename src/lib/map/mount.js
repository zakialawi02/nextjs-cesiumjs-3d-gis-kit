/**
 * Starts and stops the map page scripts. Loaded with a dynamic import() by
 * src/components/map/map-engine.tsx, so CesiumJS never runs on the server.
 *
 * Start order matches the Laravel page: UI interactions (app.js), the page script
 * (pages/map/index.blade.php), then the Cesium controller (cesium-map.js). The upload modal is a
 * React component (src/components/map/upload-modal.tsx).
 *
 * Shared client state is the map store (src/stores/map-store.ts): mountMap() puts the session in
 * it and unmounting resets it. Window globals that remain on the map page:
 * - Cesium and CESIUM_BASE_URL (cesium-map.js; Cesium resolves its workers and assets from it),
 * - proj4 and the UTM helpers (longLatToUtm, cartesianToCoords, UTM_*) from globals.js,
 * - MyZkToast / ZkPopAlert and the string helpers installed by <ClientBootstrap> (root layout).
 * Removed: mapController, cleanupMapPage, cleanupMapListeners, userRole, UploadModal, CONFIG,
 * openModal / closeModal and the upload helpers (pollJobStatus, uploadFileInChunks, ...).
 */
import { mapStore, resetMapStore } from "@/stores/map-store";

import { initMapPage } from "./cesium-map";
import { installMapGlobals } from "./globals";
import { initMapPageScript } from "./map-page";
import { initializeInteractions } from "./ui-interactions";

function safely(step, label) {
    try {
        step?.();
    } catch (error) {
        console.warn(`Map cleanup (${label}) failed:`, error);
    }
}

/** Unmount function of the mounted map (at most one at a time). */
let activeUnmount = null;

/**
 * @param {{ userRole: string, canUpload: boolean }} options
 * @returns {() => void} unmount: removes every listener, timer and subscription, destroys the
 *   viewer and resets the map store.
 */
export function mountMap({ userRole, canUpload }) {
    // A previous mount must never leave a second viewer or duplicate listeners behind.
    if (activeUnmount) {
        safely(activeUnmount, "previous mount");
    }

    window.CESIUM_BASE_URL = window.CESIUM_BASE_URL || "/cesium/";
    installMapGlobals();
    mapStore.setState({ session: { role: userRole, canUpload: Boolean(canUpload) } });

    const cleanupInteractions = initializeInteractions(document);
    const cleanupMapPage = initMapPageScript();

    let map = null;
    try {
        map = initMapPage();
    } catch (error) {
        // WebGL unavailable, for example. The panels keep working without the globe.
        console.error("Failed to start the Cesium viewer:", error);
    }

    let unmounted = false;
    function unmountMap() {
        if (unmounted) return;
        unmounted = true;
        if (activeUnmount === unmountMap) activeUnmount = null;

        // Laravel's window.cleanupMapPage(): page listeners and timers, the map listeners
        // (cleanupMapListeners) and the viewer (mapController.destroy()).
        safely(cleanupMapPage, "page");
        safely(map?.cleanup, "map listeners");
        safely(() => map?.controller.destroy(), "viewer");
        safely(cleanupInteractions, "interactions");
        safely(resetMapStore, "store");
    }

    activeUnmount = unmountMap;
    return unmountMap;
}
