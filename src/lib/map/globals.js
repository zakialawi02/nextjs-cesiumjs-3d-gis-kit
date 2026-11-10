/**
 * Browser globals of the map page (port of resources/js/map.js): proj4 with the configured UTM
 * zone and the longLatToUtm / cartesianToCoords helpers, kept on `window` for console use and
 * scripts outside src/lib/map. The map scripts import what they need instead.
 *
 * Shared map state is not on `window`: it lives in the map store (src/stores/map-store.ts).
 * The string helpers (escapeHtml, formatNumber, ...) are installed by <ClientBootstrap>; modals
 * are opened with openModal / closeModal from ./ui-interactions.
 */
import * as Cesium from "cesium";
import proj4 from "proj4";

import { WGS84_EPSG, resolveUtmConfig } from "./utils/constants";

/**
 * Convert WGS84 longitude/latitude to the configured UTM zone.
 */
export function longLatToUtm(longitude, latitude) {
    const [utmX, utmY] = proj4(WGS84_EPSG, window.UTM_EPSG, [longitude, latitude]);
    return { utmX, utmY };
}

/**
 * Convert a Cesium Cartesian3 into geographic + UTM coordinates.
 */
export function cartesianToCoords(cartesian) {
    if (!Cesium.defined(cartesian)) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    const longitude = Cesium.Math.toDegrees(cartographic.longitude);
    const latitude = Cesium.Math.toDegrees(cartographic.latitude);
    const { utmX, utmY } = longLatToUtm(longitude, latitude);
    return { longitude, latitude, altitude: cartographic.height, utmX, utmY };
}

/**
 * Installs the globals. Idempotent (safe to call on every mount).
 */
export function installMapGlobals() {
    // Global UTM configuration (src/config/geodata.ts via window.APP_GIS_CONFIG, set by the root layout).
    const activeUtm = resolveUtmConfig();
    proj4.defs(activeUtm.epsg, activeUtm.def);

    Object.assign(window, {
        proj4,
        UTM_EPSG: activeUtm.epsg,
        UTM_DEF: activeUtm.def,
        UTM_LABEL: activeUtm.label,
        UTM_ZONE: activeUtm.zone,
        UTM_HEMISPHERE: activeUtm.hemisphere,
        WGS84_EPSG,
        longLatToUtm,
        cartesianToCoords,
    });
}
