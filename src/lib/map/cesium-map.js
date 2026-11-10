/* eslint-disable @typescript-eslint/no-unused-vars -- legacy code ported verbatim from the Laravel app */
/**
 * CesiumJS map controller and page wiring (port of resources/js/cesium-map.js).
 *
 * Browser-only: loaded through a dynamic import() from src/lib/map/mount.js. The Cesium widget
 * stylesheet is imported by the client component (src/components/map/map-engine.tsx).
 * initMapPage() replaces the DOMContentLoaded handler and returns { controller, cleanup };
 * cleanup() and CesiumMapController#destroy() undo it so the page can be mounted again after a
 * client-side navigation.
 *
 * Layer visibility is published to the map store (src/stores/map-store.ts): activeTerrainId
 * (CesiumMapController#loadedTerrainId reads and writes it), visibleVectorIds and pendingLayerIds.
 * The layer cards' show/hide icons are drawn from those values.
 */
import * as Cesium from "cesium";

import { formatNumber } from "@/lib/client/helpers";
import { iconDataUri, iconSvg, isIconName } from "@/lib/icons";
import { mapStore } from "@/stores/map-store";

import {
    DistanceMeasure,
    DistanceSurfaceMeasure,
    AreaMeasure,
    AreaSurfaceMeasure,
    CircleMeasure,
} from "./cesium-measure";
import { CesiumMapDrawer } from "./cesium-drawer";
import proj4 from "proj4";
import { UTM_EPSG, UTM_DEF, WGS84_EPSG } from "./utils/constants";
import { VectorVertexIndex, findNearestIndexedVertex } from "./utils/vector-vertex-index";
import { DEFAULT_MAP_QUALITY, MapPerformanceController } from "./utils/map-performance";
import { TerrainProviderCache } from "./utils/terrain-provider-cache";
import { cartesianToCoords } from "./globals";
import { setLayerToggleIcon } from "./templates";

// Cesium's static Workers/Assets are copied to public/cesium by scripts/copy-cesium-assets.mjs.
window.CESIUM_BASE_URL = window.CESIUM_BASE_URL || "/cesium/";
window.Cesium = Cesium;
proj4.defs(UTM_EPSG, UTM_DEF);

/**
 * Configuration & Constants
 */
const DXF_SUBCLASS_COLORS = {
    AcDbLine: "#FF0000", // Red
    AcDbPolyline: "#00FF00", // Green
    AcDb3dPolyline: "#0000FF", // Blue
    AcDbPoint: "#DAA520", // Goldenrod (yellow dot)
    AcDbText: "#FFFFFF", // White
    AcDbCircle: "#00FFFF", // Cyan
    AcDbArc: "#FF00FF", // Magenta
    AcDbEllipse: "#FF7F00", // Orange
    AcDbSpline: "#7F00FF", // Purple
};

/**
 * Helper to apply button styles consistently without breaking other Tailwind/custom utility classes.
 * @param {HTMLElement} btn - The button element to style
 * @param {'active'|'inactive'|'danger'|'primary'|'tabActive'|'tabInactive'} styleName - The style variant to apply
 */
function applyBtnStyle(btn, styleName) {
    if (!btn) return;

    // Redesigned map controls are styled in app.css from state attributes instead of colour classes:
    // tool toggles ([data-map-tool]) use aria-pressed, panel actions ([data-map-action]) use data-variant.
    if (btn.hasAttribute("data-map-tool")) {
        btn.setAttribute("aria-pressed", String(styleName === "active"));
        return;
    }
    if (btn.hasAttribute("data-map-action")) {
        btn.dataset.variant = styleName;
        return;
    }

    const styles = {
        active: ["bg-primary", "text-background"],
        inactive: ["bg-neutral", "text-foreground"],
        danger: ["bg-error", "hover:bg-error/90", "text-background"],
        primary: ["bg-primary", "hover:bg-primary/90", "text-background"],
        tabActive: ["bg-primary", "text-background"],
        tabInactive: ["text-foreground/75", "hover:bg-muted"],
    };

    const allCls = Object.values(styles).flat();
    btn.classList.remove(...allCls);
    // Drop component-level hover colours (e.g. x-button-primary) so the new variant wins on hover.
    [...btn.classList].filter((cls) => /^enabled:hover:bg-/.test(cls)).forEach((cls) => btn.classList.remove(cls));

    if (styles[styleName]) {
        btn.classList.add(...styles[styleName]);
    }
}

const CONFIG = {
    DEFAULT_VIEW: {
        lon: 117.270071,
        lat: -0.637949,
        height: 2500.0,
        heading: 0.0,
        pitch: -60.0,
    },
    NAV: {
        NORTH: Cesium.Math.toRadians(0.0),
        TOP_DOWN: Cesium.Math.toRadians(-90.0),
        THRESHOLD: 0.02,
    },
    FLY: {
        DEFAULT_ALTITUDE: 1000.0,
        DURATION: 0.5,
        BBOX_DURATION: 1.0,
    },
    DEFAULT_QUALITY: DEFAULT_MAP_QUALITY,
    POLL_INTERVAL: {
        TERRAIN: 4000,
        VECTOR: 3000,
    },
    SCALE_BY_DISTANCE: new Cesium.NearFarScalar(1.0e3, 1.0, 1.5e6, 0.3),
    BOUNDARY_COLOR_ANALYSIS: "#f97316",
    CHART: {
        LINE_COLOR: "#6366f1",
        LINE_COLOR_RGBA: "rgba(99, 102, 241, 0.5)",
        COMPARE_LINE_COLOR: "#f97316",
        COMPARE_LINE_COLOR_RGBA: "rgba(249, 115, 22, 0.5)",
    },
    BASEMAP: {
        SATELLITE_URL: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    },
};
const SPINNER_HTML = iconSvg("loader-circle", { className: "animate-spin inline-block" });

/**
 * Generates grid points inside a polygon boundary at the specified resolution (in meters).
 * Uses Scanline Polygon Rasterization for high performance and an Early Estimation Guard
 * to prevent browser freezes on excessively large queries.
 * Returns { points: array } or { error, estimated }.
 */
function generateGridPoints(vertices, resolution) {
    let minLon = Infinity,
        maxLon = -Infinity;
    let minLat = Infinity,
        maxLat = -Infinity;
    vertices.forEach((v) => {
        if (v.longitude < minLon) minLon = v.longitude;
        if (v.longitude > maxLon) maxLon = v.longitude;
        if (v.latitude < minLat) minLat = v.latitude;
        if (v.latitude > maxLat) maxLat = v.latitude;
    });

    const midLat = (minLat + maxLat) / 2;
    const latStep = resolution / 111320;
    const lonStep = resolution / (111320 * Math.cos(Cesium.Math.toRadians(midLat)));

    // 1. Early Estimation Guard to prevent massive synchronous loops
    const latSteps = Math.ceil((maxLat - minLat) / latStep);
    const lonSteps = Math.ceil((maxLon - minLon) / lonStep);
    const estimatedBoundingPoints = latSteps * lonSteps;

    // Safety limit: if the bounding box produces over 50,000 potential checks,
    // abort instantly. This prevents the browser UI from locking up entirely.
    if (estimatedBoundingPoints > 50000) {
        return { error: "TOO_MANY_POINTS", estimated: estimatedBoundingPoints };
    }

    const gridPoints = [];

    // 2. Scanline Polygon Rasterization Algorithm
    // Iterate over each latitude line (scanline)
    for (let lat = minLat; lat <= maxLat; lat += latStep) {
        const intersections = [];

        // Find intersections of the scanline with polygon edges
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const v1 = vertices[i];
            const v2 = vertices[j];

            // Does the scanline cross the edge vertically? (excluding perfectly horizontal edges)
            if (
                (v1.latitude >= lat && v2.latitude < lat) ||
                (v2.latitude >= lat && v1.latitude < lat)
            ) {
                // Linear interpolation to find the longitude of the intersection
                const t = (lat - v1.latitude) / (v2.latitude - v1.latitude);
                const intersectLon = v1.longitude + t * (v2.longitude - v1.longitude);
                intersections.push(intersectLon);
            }
        }

        // Sort intersections from west to east
        intersections.sort((a, b) => a - b);

        // Fill spans inside the polygon using the odd-even rule
        for (let k = 0; k < intersections.length; k += 2) {
            const startLon = intersections[k];
            const endLon = intersections[k + 1];
            if (startLon === undefined || endLon === undefined) continue;

            // Align start and end to the grid coordinate indices to maintain uniform spacing
            const firstLonIdx = Math.ceil((startLon - minLon) / lonStep);
            const lastLonIdx = Math.floor((endLon - minLon) / lonStep);

            for (let idx = firstLonIdx; idx <= lastLonIdx; idx++) {
                const lon = minLon + idx * lonStep;
                gridPoints.push({ longitude: lon, latitude: lat });
            }
        }
    }

    return { points: gridPoints };
}

/**
 * CesiumMapController: Handles all CesiumJS interactions and performance optimizations.
 */
class CesiumMapController {
    constructor(containerId) {
        this.viewer = new Cesium.Viewer(containerId, {
            // Base layer: NaturalEarthII (bundled default basemap)
            baseLayer: Cesium.ImageryLayer.fromProviderAsync(
                Cesium.TileMapServiceImageryProvider.fromUrl(
                    Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
                ),
            ),
            animation: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            vrButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            navigationHelpButton: false,
            navigationInstructionsInitiallyVisible: false,
            scene3DOnly: true,
            // Performance: Only render when something changes
            requestRenderMode: true,
            maximumRenderTimeChange: Infinity,
            // Visual Quality vs Performance
            msaaSamples: 1, // Minimize if mobile/low-end
        });

        // Add an online basemap on top. If online, this will cover NaturalEarth.
        // If offline, this tile fails to load (transparent), so NaturalEarth underneath will be visible.
        // const onlineMap = new Cesium.UrlTemplateImageryProvider({
        //     url: CONFIG.BASEMAP.SATELLITE_URL,
        //     maximumLevel: 20,
        // });
        // this.viewer.imageryLayers.addImageryProvider(onlineMap);

        // Disable default double-click entity tracking/pivoting
        this.viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
            Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
        );

        // Load initial visual/performance settings from localStorage or defaults
        const storedShadows = localStorage.getItem("map_settings_shadows") === "true"; // default false
        // Atmosphere permanently disabled
        const storedDepthTest = localStorage.getItem("map_settings_depth_test") === "true"; // default false
        const storedFPS = localStorage.getItem("map_settings_fps") === "true"; // default false
        const storedQuality = localStorage.getItem("map_settings_quality");

        // Apply visual and performance settings
        this.viewer.shadows = storedShadows;
        this.viewer.terrainShadows = storedShadows
            ? Cesium.ShadowMode.ENABLED
            : Cesium.ShadowMode.DISABLED;
        this.viewer.scene.globe.enableLighting = true;
        this.viewer.scene.globe.showAtmosphere = false;
        this.viewer.scene.globe.depthTestAgainstTerrain = storedDepthTest;
        this._syncDepthTestToggle();
        this.viewer.scene.debugShowFramesPerSecond = storedFPS;
        this.performanceController = new MapPerformanceController(this.viewer, {
            quality: storedQuality,
        });
        this.viewer.scene.globe.terrainExaggeration = 1.5;

        this.viewer.scene.globe.showGroundReference = true;
        this.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

        // Set fixed time of day to afternoon (sore hari) - 17 June 2026, 16:30 WITA (08:30 UTC)
        const fixedTime = Cesium.JulianDate.fromIso8601("2026-06-17T08:30:00Z");
        this.viewer.clock.currentTime = fixedTime;
        this.viewer.clock.startTime = Cesium.JulianDate.fromIso8601("2026-06-17T00:00:00Z");
        this.viewer.clock.stopTime = Cesium.JulianDate.fromIso8601("2026-06-17T23:59:59Z");
        this.viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
        this.viewer.clock.shouldAnimate = false;

        // Automatically request render whenever terrain/imagery tiles are downloading
        // Fixes stuck black screen issue when requestRenderMode is enabled
        this.viewer.scene.globe.tileLoadProgressEvent.addEventListener((queueLength) => {
            if (queueLength > 0) {
                this.viewer.scene.requestRender();
            }
        });

        // Recover gracefully from render errors (e.g. offline terrain height requests)
        // instead of stopping rendering completely ("An error occurred while rendering. Rendering has stopped.")
        this.viewer.scene.renderError.addEventListener((scene, error) => {
            console.error("Cesium render error - attempting recovery:", error || scene);
            this.viewer.scene.requestRenderMode = false;
            setTimeout(() => {
                if (!this.viewer) return; // destroyed meanwhile (page unmounted)
                this.viewer.scene.requestRenderMode = true;
                this.viewer.scene.requestRender();
            }, 300);
        });

        this.loadedTerrainId = null;
        this.loadedImageryLayer = null;
        this.terrainCache = new TerrainProviderCache((url) =>
            Cesium.CesiumTerrainProvider.fromUrl(url, {
                requestWaterMask: false,
                requestVertexNormals: false,
            }),
        );

        // Geolocation state
        this.watchId = null;
        this.geolocationEntity = null;
        this.lastPosition = null;
        this.activeVectorLayers = new Map();

        this.selectedFeature = null;
        this.selectedOriginalColor = null;

        // Coordinate Picker state
        this.coordPickerMode = false;
        this._coordPickerClickHandler = null;
        this._coordPickerTempEntity = null;

        // Pivot State
        this.pivotMode = false;
        this.pivotPoint = null;
        this._pivotPointEntity = null;
        this._pivotClickHandler = null;
        this._pivotCameraLocked = false;

        // Device Compass state
        this.deviceCompassActive = false;
        this.deviceOrientationHandler = null;

        this.isTogglingTerrain = false;

        // Measurement state
        this.activeMeasureMode = null;
        this.distanceMeasure = null;
        this.distanceSurfaceMeasure = null;
        this.areaMeasure = null;
        this.areaSurfaceMeasure = null;
        this.circleMeasure = null;

        // Shared drawer + drawing control bar (measure and analysis tools)
        this.activeDrawer = null;
        this._drawingControlContext = null;

        // Cut & Fill state
        this.cutFillMode = false;
        this.cutFillPoints = [];
        this.cutFillPolylineEntity = null;
        this.cutFillPolygonEntity = null;
        this.cutFillHeatmapEntities = [];
        this.cutFillPointEntities = [];
        this.cutFillPrimitive = null;
        this.cutFillPointsCollection = null;
        this.cutFillHeatmapEntity = null;
        this._cutFillGridLookup = null;
        this.cutFillBoundaryPointEntities = [];
        this.cutFillLabelEntities = [];
        this.cutFillHoverPoint = null;
        this.cutFillResultsData = null;
        this.comparisonTerrainLayers = [];

        // Profile state
        this.profileMode = false;
        this.profilePoints = [];
        this.profilePolylineEntity = null;
        this.profilePointEntities = [];
        this.profileLabelEntities = [];
        this.profileHoverPoint = null;
        this.profileMarkerEntity = null;

        this.initView();
        this.initMousePosition();
        this.initFeaturePicking();
    }

    static heightRef(hasAltitude) {
        return hasAltitude ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND;
    }

    /**
     * Checks if terrain is available and active in the viewer.
     * @returns {boolean} True if terrain is available, false otherwise.
     */
    _isTerrainAvailable() {
        const tp = this.viewer.terrainProvider;
        if (!tp || tp instanceof Cesium.EllipsoidTerrainProvider) {
            return false;
        }
        if (!navigator.onLine) {
            return false;
        }
        return true;
    }




    /**
     * Billboard image for a temporary marker: a registered Lucide icon (src/lib/icons.ts) filled
     * with `color` and outlined in white; unknown names fall back to the map pin.
     */
    static resolveBillboardImage(iconName, color, size = 32) {
        const name = isIconName(iconName) ? iconName : "map-pin";
        return iconDataUri(name, { size, fill: color, stroke: "#ffffff", strokeWidth: 1.5 });
    }

    initFeaturePicking() {
        const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        this._featurePickingHandler = handler; // destroyed in destroy()
        handler.setInputAction((movement) => {
            if (this.coordPickerMode || this.pivotMode || this.cutFillMode || this.profileMode) return;

            const pickedObject = this.viewer.scene.pick(movement.position);

            this._clearFeatureHighlight();

            if (Cesium.defined(pickedObject) && pickedObject.id) {
                this._highlightFeature(pickedObject);

                let propsToShow = pickedObject.id;
                // If the picked object is a Cesium Entity
                if (pickedObject.id instanceof Cesium.Entity) {
                    if (pickedObject.id.properties) {
                        propsToShow =
                            pickedObject.id.properties.getValue(Cesium.JulianDate.now()) || {};
                    } else {
                        propsToShow = {
                            name: pickedObject.id.name || "Unknown",
                            id: pickedObject.id.id,
                        };
                    }
                }

                this.showFeatureProperties(propsToShow);
            } else {
                this.hideFeatureProperties();
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    /**
     * Highlights a selected feature on the map.
     * @param {Object} pickedObject - The picked Cesium object.
     */
    _highlightFeature(pickedObject) {
        this.selectedFeature = pickedObject;

        if (!pickedObject.primitive) return;

        if (pickedObject.primitive instanceof Cesium.PointPrimitive) {
            this.selectedOriginalColor = pickedObject.primitive.color.clone();
            pickedObject.primitive.color = Cesium.Color.RED;
        } else if (typeof pickedObject.primitive.getGeometryInstanceAttributes === "function") {
            const attributes = pickedObject.primitive.getGeometryInstanceAttributes(
                pickedObject.id,
            );
            if (attributes && attributes.color) {
                this.selectedOriginalColor = Array.from(attributes.color);
                attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(
                    Cesium.Color.RED.withAlpha(0.6),
                );
            }
        }
        this.viewer.scene.requestRender();
    }

    /**
     * Clears the currently highlighted feature and restores its original color.
     */
    _clearFeatureHighlight() {
        if (this.selectedFeature) {
            if (
                !this.selectedFeature.primitive ||
                (typeof this.selectedFeature.primitive.isDestroyed === "function" &&
                    this.selectedFeature.primitive.isDestroyed())
            ) {
                this.selectedFeature = null;
                this.selectedOriginalColor = null;
                return;
            }
            if (this.selectedFeature.primitive instanceof Cesium.PointPrimitive) {
                this.selectedFeature.primitive.color = this.selectedOriginalColor;
            } else if (
                typeof this.selectedFeature.primitive.getGeometryInstanceAttributes === "function"
            ) {
                const attributes = this.selectedFeature.primitive.getGeometryInstanceAttributes(
                    this.selectedFeature.id,
                );
                if (attributes && attributes.color && this.selectedOriginalColor) {
                    attributes.color = this.selectedOriginalColor;
                }
            }
            this.selectedFeature = null;
            this.selectedOriginalColor = null;
            this.viewer.scene.requestRender();
        }
    }

    showFeatureProperties(properties) {
        this.currentProperties = properties;

        const panel = document.getElementById("featurePropertiesPanel");
        const content = document.getElementById("featurePropertiesContent");

        if (!panel || !content) return;

        content.innerHTML = "";

        if (!properties || Object.keys(properties).length === 0) {
            const p = document.createElement("p");
            p.className = "map-prop-empty";
            p.textContent = "No properties available.";
            content.appendChild(p);
        } else {
            let latKey = null;
            let lngKey = null;
            let latVal = null;
            let lngVal = null;

            for (const key of Object.keys(properties)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === "latitude" || lowerKey === "lat") {
                    latKey = key;
                    latVal = properties[key];
                } else if (lowerKey === "longitude" || lowerKey === "long" || lowerKey === "lng") {
                    lngKey = key;
                    lngVal = properties[key];
                }
            }

            const parsedLat = parseFloat(latVal);
            const parsedLng = parseFloat(lngVal);
            const hasValidCoords = !isNaN(parsedLat) && !isNaN(parsedLng);
            // No coordinate-system switch in this build: properties show WGS84 like the coordinate bar.
            const isUtm = false;

            let utmX = null;
            let utmY = null;
            if (hasValidCoords && isUtm) {
                try {
                    const [calculatedX, calculatedY] = proj4(WGS84_EPSG, UTM_EPSG, [
                        parsedLng,
                        parsedLat,
                    ]);
                    utmX = calculatedX;
                    utmY = calculatedY;
                } catch (err) {
                    console.error(
                        "Failed to convert coordinates to UTM in feature properties:",
                        err,
                    );
                }
            }

            for (const [key, value] of Object.entries(properties)) {
                let displayKey = key;
                let displayValue = value;

                if (hasValidCoords) {
                    if (key === latKey) {
                        if (isUtm && utmY !== null) {
                            displayKey = "UTM Y (Northing)";
                            displayValue = utmY.toFixed(4);
                        } else {
                            displayKey = key;
                            displayValue = parsedLat.toFixed(6);
                        }
                    } else if (key === lngKey) {
                        if (isUtm && utmX !== null) {
                            displayKey = "UTM X (Easting)";
                            displayValue = utmX.toFixed(4);
                        } else {
                            displayKey = key;
                            displayValue = parsedLng.toFixed(6);
                        }
                    }
                }

                const wrapper = document.createElement("div");
                wrapper.className = "map-prop";

                const keySpan = document.createElement("span");
                keySpan.className = "map-prop-key";
                keySpan.textContent = displayKey;

                const valSpan = document.createElement("span");
                valSpan.className = "map-prop-value";
                valSpan.textContent = displayValue ?? "-";

                wrapper.appendChild(keySpan);
                wrapper.appendChild(valSpan);
                content.appendChild(wrapper);
            }
        }

        panel.classList.remove("translate-x-[150%]");
    }

    hideFeatureProperties() {
        const panel = document.getElementById("featurePropertiesPanel");
        if (panel) {
            panel.classList.add("translate-x-[150%]");
        }
        this.currentProperties = null;
    }

    refreshFeatureProperties() {
        if (this.currentProperties) {
            this.showFeatureProperties(this.currentProperties);
        }
    }

    initView() {
        this.viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(
                CONFIG.DEFAULT_VIEW.lon,
                CONFIG.DEFAULT_VIEW.lat,
                CONFIG.DEFAULT_VIEW.height,
            ),
            orientation: {
                heading: Cesium.Math.toRadians(CONFIG.DEFAULT_VIEW.heading),
                pitch: Cesium.Math.toRadians(CONFIG.DEFAULT_VIEW.pitch),
                roll: 0.0,
            },
        });
    }

    /**
     * Picks a position on the globe from screen coordinates.
     * @param {Cesium.Cartesian2} screenPosition - The screen position.
     * @returns {Cesium.Cartesian3|undefined} The Cartesian3 position or undefined.
     */
    _pickGlobePosition(screenPosition) {
        let cartesian;
        if (this.viewer.scene.mode === Cesium.SceneMode.SCENE3D) {
            const ray = this.viewer.camera.getPickRay(screenPosition);
            cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
        }

        // Fallback to ellipsoid if globe pick failed
        if (!Cesium.defined(cartesian)) {
            cartesian = this.viewer.camera.pickEllipsoid(
                screenPosition,
                this.viewer.scene.globe.ellipsoid,
            );
        }
        return cartesian;
    }

    initMousePosition() {
        const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        this._mousePositionHandler = handler; // destroyed in destroy()
        const latEl = document.getElementById("latValue");
        const longEl = document.getElementById("longValue");
        const overlay = document.getElementById("coordinateOverlay");
        const utmXEl = document.getElementById("xValue");
        const utmYEl = document.getElementById("yValue");

        handler.setInputAction((movement) => {
            const cartesian = this._pickGlobePosition(movement.endPosition);

            const coords = cartesianToCoords(cartesian);

            if (coords) {
                if (latEl) latEl.textContent = coords.latitude.toFixed(6);
                if (longEl) longEl.textContent = coords.longitude.toFixed(6);
                if (utmXEl) utmXEl.textContent = coords.utmX.toFixed(4);
                if (utmYEl) utmYEl.textContent = coords.utmY.toFixed(4);

                if (overlay) {
                    overlay.classList.remove("opacity-0");
                    overlay.classList.add("opacity-100");
                }
            } else {
                if (overlay) {
                    overlay.classList.add("opacity-0");
                    overlay.classList.remove("opacity-100");
                }
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    zoomIn() {
        this.viewer.camera.zoomIn(this.viewer.camera.positionCartographic.height * 0.6);
    }

    zoomOut() {
        this.viewer.camera.zoomOut(this.viewer.camera.positionCartographic.height * 0.6);
    }

    /**
     * Gets the current center position of the map camera.
     * @returns {Cesium.Cartographic|null} The center position or null if unavailable.
     */
    _getCenterPosition() {
        const windowPosition = new Cesium.Cartesian2(
            this.viewer.container.clientWidth / 2,
            this.viewer.container.clientHeight / 2,
        );
        return this._pickGlobePosition(windowPosition);
    }

    /**
     * Flies the camera to a specific orientation.
     * @param {number} heading - The target heading in radians.
     * @param {number} pitch - The target pitch in radians.
     */
    _flyToOrientation(heading, pitch) {
        const center = this._getCenterPosition();
        if (Cesium.defined(center)) {
            const range = Cesium.Cartesian3.distance(center, this.viewer.camera.positionWC);
            this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 0), {
                duration: CONFIG.FLY.DURATION,
                offset: new Cesium.HeadingPitchRange(heading, pitch, range),
            });
        } else {
            this.viewer.camera.flyTo({
                destination: this.viewer.camera.positionWC.clone(),
                orientation: {
                    heading: heading,
                    pitch: pitch,
                    roll: 0.0,
                },
                duration: CONFIG.FLY.DURATION,
            });
        }
    }

    resetNorth() {
        this._flyToOrientation(CONFIG.NAV.NORTH, this.viewer.camera.pitch);
    }

    resetTopView() {
        this._flyToOrientation(CONFIG.NAV.NORTH, CONFIG.NAV.TOP_DOWN);
    }

    getHeadingDegrees() {
        return Cesium.Math.toDegrees(this.viewer.camera.heading);
    }

    /**
     * Google Maps-style compass click:
     * - If map is rotated (heading ≠ 0): reset north
     * - If already north but tilted (pitch ≠ -90°): reset to top view
     * - If already north AND top-down: no-op
     */
    handleCompassClick() {
        // Automatically turn off device compass tracking if active
        if (this.deviceCompassActive) {
            this.toggleDeviceCompass();
        }

        const heading = this.viewer.camera.heading;
        const pitch = this.viewer.camera.pitch;
        const THRESHOLD = CONFIG.NAV.THRESHOLD;

        const isNorth = heading < THRESHOLD || heading > 2 * Math.PI - THRESHOLD;
        const isTopDown = Math.abs(pitch - CONFIG.NAV.TOP_DOWN) < THRESHOLD;

        if (!isNorth) {
            this.resetNorth();
        } else if (!isTopDown) {
            this.resetTopView();
        }
    }

    _startGeolocation() {
        const btn = document.getElementById("geolocationBtn");
        if (btn) {
            applyBtnStyle(btn, "active");
        }

        const geolocationProperty = new Cesium.SampledPositionProperty();
        geolocationProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        geolocationProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;

        // Limit the number of samples to keep memory in check (e.g., store last 20 samples)
        const sampleTimes = [];
        const MAX_SAMPLES = 20;

        this.viewer.scene.requestRenderMode = false;
        this.viewer.clock.shouldAnimate = true;

        // Custom SVG Marker (Google Maps Navigation Style)
        const svgMarker =
            "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='28' fill='rgba(37, 99, 235, 0.3)' /%3E%3Ccircle cx='32' cy='32' r='20' fill='%232563eb' stroke='%23ffffff' stroke-width='2' /%3E%3Cpath d='M 32 14 L 44 42 L 32 36 L 20 42 Z' fill='%23ffffff' /%3E%3C/svg%3E";

        this.currentHeading = 0; // Default facing North

        this.geolocationEntity = this.viewer.entities.add({
            name: "My Location",
            position: geolocationProperty,
            billboard: {
                image: svgMarker,
                scale: 0.6,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: CONFIG.SCALE_BY_DISTANCE,
                rotation: new Cesium.CallbackProperty(() => {
                    return this.viewer.camera.heading - this.currentHeading;
                }, false),
            },
        });

        this.watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                const heading = pos.coords.heading;
                const isFirst = !this.lastPosition;

                if (this.lastPosition) {
                    const distance = this.calculateDistance(
                        this.lastPosition.lat,
                        this.lastPosition.lon,
                        lat,
                        lon,
                    );

                    if (heading !== null && !isNaN(heading)) {
                        this.currentHeading = Cesium.Math.toRadians(heading);
                    } else if (distance > 0.5) {
                        const lat1 = Cesium.Math.toRadians(this.lastPosition.lat);
                        const lon1 = Cesium.Math.toRadians(this.lastPosition.lon);
                        const lat2 = Cesium.Math.toRadians(lat);
                        const lon2 = Cesium.Math.toRadians(lon);
                        const dLon = lon2 - lon1;
                        const y = Math.sin(dLon) * Math.cos(lat2);
                        const x =
                            Math.cos(lat1) * Math.sin(lat2) -
                            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
                        const brng = Math.atan2(y, x);
                        this.currentHeading = (brng + 2 * Math.PI) % (2 * Math.PI);
                    }

                    if (distance < 2) return;
                } else if (heading !== null && !isNaN(heading)) {
                    this.currentHeading = Cesium.Math.toRadians(heading);
                }

                this.lastPosition = { lat, lon };

                const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
                const time = Cesium.JulianDate.clone(this.viewer.clock.currentTime);

                if (isFirst) {
                    geolocationProperty.addSample(time, position);
                    sampleTimes.push(Cesium.JulianDate.clone(time));

                    this.viewer.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(
                            lon,
                            lat,
                            250.0, // closer altitude for tracking
                        ),
                        orientation: {
                            heading: this.viewer.camera.heading,
                            pitch: Cesium.Math.toRadians(-90), // tegak / upright
                            roll: 0.0,
                        },
                    });
                } else {
                    const sampleTime = Cesium.JulianDate.addSeconds(
                        time,
                        1.5,
                        new Cesium.JulianDate(),
                    );
                    geolocationProperty.addSample(sampleTime, position);
                    sampleTimes.push(sampleTime);

                    if (sampleTimes.length > MAX_SAMPLES) {
                        const oldestTime = sampleTimes.shift();
                        geolocationProperty.removeSamplesBefore(oldestTime);
                    }
                }
            },
            (error) => {
                console.error("Geolocation error: ", error);
                alert("Failed to get location: " + error.message);
                if (this.watchId !== null) {
                    this.toggleGeolocation(); // turn off tracking
                }
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000,
            },
        );
    }

    _stopGeolocation() {
        const btn = document.getElementById("geolocationBtn");

        // Auto-disable device compass tracking if active
        if (this.deviceCompassActive) {
            this.toggleDeviceCompass();
        }

        // Stop tracking
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        if (this.geolocationEntity) {
            this.viewer.entities.remove(this.geolocationEntity);
            this.geolocationEntity = null;
        }
        this.lastPosition = null;

        // Revert button styles
        if (btn) {
            applyBtnStyle(btn, "inactive");
        }

        // Restore render mode to save battery
        this.viewer.scene.requestRenderMode = true;
        this.viewer.clock.shouldAnimate = false;

        this.viewer.scene.requestRender();
    }

    async toggleGeolocation() {
        if (!navigator.geolocation) {
            alert("Your browser does not support geolocation.");
            return;
        }

        if (this.watchId !== null) {
            this._stopGeolocation();
        } else {
            // Cek status izin (permission) geolocation jika API navigator.permissions didukung
            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const permissionStatus = await navigator.permissions.query({
                        name: "geolocation",
                    });
                    if (permissionStatus.state === "denied") {
                        alert(
                            "Location access denied. Please allow location access in your browser and device settings.",
                        );
                        return;
                    }
                } catch (err) {
                    console.warn(
                        "navigator.permissions.query is not fully supported in this browser:",
                        err,
                    );
                }
            }

            this._disablePivotMode();
            this._startGeolocation();
        }
    }

    /**
     * Toggle depth testing against terrain, so vector features behind hills or below
     * the surface are hidden. The choice is remembered in localStorage.
     */
    toggleDepthTestAgainstTerrain() {
        const isEnabled = !this.viewer.scene.globe.depthTestAgainstTerrain;

        this.viewer.scene.globe.depthTestAgainstTerrain = isEnabled;
        localStorage.setItem("map_settings_depth_test", String(isEnabled));
        this._syncDepthTestToggle();

        this.viewer.scene.requestRender();
    }

    /**
     * Reflect the current depth test state on the switch in the account menu.
     */
    _syncDepthTestToggle() {
        document
            .getElementById("depthTestToggle")
            ?.setAttribute("aria-pressed", String(this.viewer.scene.globe.depthTestAgainstTerrain));
    }

    /**
     * Toggle pivot camera mode (separate button).
     * Chose point location by user for center pivot view
     */
    togglePivotCamera() {
        const btn = document.getElementById("pivotCamBtn");

        if (this.pivotMode) {
            // === DEACTIVATE PIVOT ===
            this._disablePivotMode();
            return;
        }

        // === ACTIVATE PIVOT PICKING ===

        // 1. Auto-disable conflicting modes
        if (this.deviceCompassActive) {
            this.toggleDeviceCompass();
        }
        if (this.coordPickerMode) {
            this.disableCoordinatePickerMode();
        }
        if (this.activeMeasureMode) {
            this.disableAllMeasureModes();
        }

        // 2. Set state
        this.pivotMode = true;
        this._pivotCameraLocked = false;
        this.viewer.canvas.style.cursor = "crosshair";

        // 3. UI feedback
        applyBtnStyle(btn, "active");
        this._showPivotToast("Click a point on the map to set the pivot center");

        // 4. Create separate click handler for picking
        this._pivotClickHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

        this._pivotClickHandler.setInputAction((movement) => {
            const cartesian = this._pickGlobePosition(movement.position);
            if (!Cesium.defined(cartesian)) return;

            // Save pivot point
            this.pivotPoint = cartesian;

            // Remove old marker if exists
            if (this._pivotPointEntity) {
                this.viewer.entities.remove(this._pivotPointEntity);
            }

            // Create marker entity at pivot point
            this._pivotPointEntity = this.viewer.entities.add({
                name: "Pivot Point",
                position: cartesian,
                point: {
                    pixelSize: 8,
                    color: Cesium.Color.RED.withAlpha(0.9),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });

            // Compute current camera offset relative to the target
            const offset = this._computeCameraOffsetFromTarget(cartesian);

            // Lock camera orbit to the point
            const transform = Cesium.Transforms.eastNorthUpToFixedFrame(cartesian);
            this.viewer.camera.lookAtTransform(transform, offset);
            this._pivotCameraLocked = true;

            // Cleanup click handler after point is picked
            if (this._pivotClickHandler) {
                this._pivotClickHandler.destroy();
                this._pivotClickHandler = null;
            }

            // Reset cursor and update toast
            this.viewer.canvas.style.cursor = "default";
            this._showPivotToast(
                "Pivot active — drag to orbit | Click the button again to turn it off",
            );
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    /**
     * Disable pivot mode and unlock the camera.
     */
    _disablePivotMode() {
        const btn = document.getElementById("pivotCamBtn");

        this.pivotMode = false;
        this._pivotCameraLocked = false;

        // Unlock camera
        this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

        // Remove marker entity
        if (this._pivotPointEntity) {
            this.viewer.entities.remove(this._pivotPointEntity);
            this._pivotPointEntity = null;
        }
        this.pivotPoint = null;

        // Destroy click handler if active
        if (this._pivotClickHandler) {
            this._pivotClickHandler.destroy();
            this._pivotClickHandler = null;
        }

        // Reset UI
        this.viewer.canvas.style.cursor = "default";
        this._hidePivotToast();
        applyBtnStyle(btn, "inactive");

        this.viewer.scene.requestRender();
    }

    /**
     * Compute HeadingPitchRange offset from camera to target.
     */
    _computeCameraOffsetFromTarget(targetCartesian) {
        const camera = this.viewer.camera;
        const heading = camera.heading;
        const pitch = camera.pitch;
        const range = Cesium.Cartesian3.distance(camera.positionWC, targetCartesian);
        return new Cesium.HeadingPitchRange(heading, pitch, range);
    }

    /**
     * Show/create pivot toast UI.
     */
    _showPivotToast(message) {
        let toast = document.getElementById("pivotToast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "pivotToast";
            toast.className = "map-hint map-glass"; // Styled in app.css (map workspace).
            toast.setAttribute("role", "status");
            document.getElementById("cesiumContainer")?.parentElement?.appendChild(toast);
        }
        toast.innerHTML = `${iconSvg("crosshair", { className: "text-red-400" })} ${message}`;
        toast.classList.remove("hidden", "opacity-0");
        toast.classList.add("opacity-100");
    }

    /**
     * Hide pivot toast UI.
     */
    _hidePivotToast() {
        const toast = document.getElementById("pivotToast");
        if (toast) {
            toast.classList.add("hidden", "opacity-0");
            toast.classList.remove("opacity-100");
        }
    }

    /**
     * Toggle device compass mode (separate button).
     * Requires geolocation to be active first.
     */
    toggleDeviceCompass() {
        const btn = document.getElementById("trackingBtn");

        if (this.deviceCompassActive) {
            // Stop device compass
            this.deviceCompassActive = false;
            if (this.deviceOrientationHandler) {
                window.removeEventListener(
                    "deviceorientation",
                    this.deviceOrientationHandler,
                    false,
                );
                this.deviceOrientationHandler = null;
            }
            if (btn) {
                applyBtnStyle(btn, "inactive");
            }

            // Unlock camera pivot from the geolocation point
            this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

            this.viewer.scene.requestRender();
            return;
        }

        // Must have geolocation active first
        if (this.watchId === null) {
            alert("Please enable geolocation first.");
            return;
        }

        // Disable pivot mode if active
        if (this.pivotMode) {
            this._disablePivotMode();
        }

        const startCompass = () => {
            if (!window.DeviceOrientationEvent) {
                alert("Device orientation is not supported on this browser/device.");
                return;
            }

            this.deviceCompassActive = true;
            if (btn) {
                applyBtnStyle(btn, "active");
            }

            this.deviceOrientationHandler = (event) => {
                if (!this.deviceCompassActive) return;

                let heading = 0;
                if (event.webkitCompassHeading) {
                    heading = event.webkitCompassHeading;
                } else if (event.alpha !== null) {
                    heading = 360 - event.alpha;
                } else {
                    return;
                }

                if (this.lastPosition) {
                    const center = Cesium.Cartesian3.fromDegrees(
                        this.lastPosition.lon,
                        this.lastPosition.lat,
                        0,
                    );

                    let range;
                    if (
                        Cesium.Matrix4.equals(this.viewer.camera.transform, Cesium.Matrix4.IDENTITY)
                    ) {
                        range = Cesium.Cartesian3.distance(center, this.viewer.camera.positionWC);
                    } else {
                        // When locked, camera.position is in local frame, so magnitude is the distance to center
                        range = Cesium.Cartesian3.magnitude(this.viewer.camera.position);
                    }

                    if (range < 10) range = CONFIG.FLY.DEFAULT_ALTITUDE;

                    this.viewer.camera.lookAt(
                        center,
                        new Cesium.HeadingPitchRange(
                            Cesium.Math.toRadians(heading),
                            this.viewer.camera.pitch,
                            range,
                        ),
                    );
                } else {
                    this.viewer.camera.setView({
                        orientation: {
                            heading: Cesium.Math.toRadians(heading),
                            pitch: this.viewer.camera.pitch,
                            roll: this.viewer.camera.roll,
                        },
                    });
                }
            };

            window.addEventListener("deviceorientation", this.deviceOrientationHandler, false);
        };

        // iOS 13+ requires explicit permission request
        if (
            typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function"
        ) {
            DeviceOrientationEvent.requestPermission()
                .then((permissionState) => {
                    if (permissionState === "granted") {
                        startCompass();
                    } else {
                        alert("Permission to access device orientation was denied.");
                    }
                })
                .catch((error) => {
                    console.error("Error requesting device orientation permission:", error);
                    alert("Failed to request permission for the device compass.");
                });
        } else {
            startCompass();
        }
    }

    async loadTerrain(layerId, terrainUrl) {
        try {
            const terrainProvider = await this.terrainCache.get(terrainUrl);

            this.viewer.terrainProvider = terrainProvider;
            this.loadedTerrainId = layerId;

            this.viewer.scene.requestRender();
            return true;
        } catch (error) {
            console.error("Error loading terrain:", error);
            this.loadedTerrainId = null;
            return false;
        }
    }

    resetTerrain() {
        this.viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        this.loadedTerrainId = null;

        this.viewer.scene.requestRender();
    }



    /**
     * Parse bounding box object to Cesium.Rectangle
     * @param {object} bbox
     * @returns {Cesium.Rectangle|null}
     */
    _parseBboxToRectangle(bbox) {
        if (!bbox) return null;

        const west = bbox.west ?? bbox.minx ?? bbox.minX;
        const south = bbox.south ?? bbox.miny ?? bbox.minY;
        const east = bbox.east ?? bbox.maxx ?? bbox.maxX;
        const north = bbox.north ?? bbox.maxy ?? bbox.maxY;

        if (
            west === undefined ||
            south === undefined ||
            east === undefined ||
            north === undefined
        ) {
            return null;
        }

        return Cesium.Rectangle.fromDegrees(
            parseFloat(west),
            parseFloat(south),
            parseFloat(east),
            parseFloat(north),
        );
    }

    addXYZImagery(xyzTileUrl, bbox = null, minZoom = 10, maxZoom = 18) {
        this.removeImageryLayer();

        let rectangle = this._parseBboxToRectangle(bbox);

        const provider = new Cesium.UrlTemplateImageryProvider({
            url: xyzTileUrl,
            rectangle: rectangle,
            minimumLevel: parseInt(minZoom),
            maximumLevel: parseInt(maxZoom),
        });

        this.loadedImageryLayer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.viewer.scene.requestRender();
    }

    removeImageryLayer() {
        if (this.loadedImageryLayer) {
            this.viewer.imageryLayers.remove(this.loadedImageryLayer);
            this.loadedImageryLayer = null;
        }
        this.viewer.scene.requestRender();
    }

    flyToBoundingBox(bbox) {
        if (!bbox) return;

        const rectangle = this._parseBboxToRectangle(bbox);
        if (!rectangle) return;

        this.viewer.camera.flyTo({
            destination: rectangle,
            duration: CONFIG.FLY.BBOX_DURATION,
        });
    }

    _hasAltitudeValue(geom) {
        if (!geom || !geom.coordinates) return false;
        try {
            if (geom.type === "Point") {
                return geom.coordinates[2] !== undefined;
            } else if (geom.type === "MultiPoint" || geom.type === "LineString") {
                return geom.coordinates[0] && geom.coordinates[0][2] !== undefined;
            } else if (geom.type === "MultiLineString" || geom.type === "Polygon") {
                return (
                    geom.coordinates[0] &&
                    geom.coordinates[0][0] &&
                    geom.coordinates[0][0][2] !== undefined
                );
            } else if (geom.type === "MultiPolygon") {
                return (
                    geom.coordinates[0] &&
                    geom.coordinates[0][0] &&
                    geom.coordinates[0][0][0] &&
                    geom.coordinates[0][0][0][2] !== undefined
                );
            }
        } catch (e) {
            console.warn("Error checking altitude, defaulting to false:", e);
        }
        return false;
    }

    _getLineStringMidpoint(coords) {
        if (!coords || coords.length === 0) return null;
        if (coords.length === 1) return coords[0];
        if (coords.length === 2) {
            return [
                (coords[0][0] + coords[1][0]) / 2,
                (coords[0][1] + coords[1][1]) / 2,
                ((coords[0][2] || 0) + (coords[1][2] || 0)) / 2,
            ];
        }

        // Calculate total length (using Euclidean approximation on coordinate degrees)
        let totalLength = 0;
        const lengths = [];
        for (let i = 0; i < coords.length - 1; i++) {
            const dx = coords[i + 1][0] - coords[i][0];
            const dy = coords[i + 1][1] - coords[i][1];
            const dist = Math.sqrt(dx * dx + dy * dy);
            lengths.push(dist);
            totalLength += dist;
        }

        const halfLength = totalLength / 2;
        let accumulated = 0;
        for (let i = 0; i < lengths.length; i++) {
            if (accumulated + lengths[i] >= halfLength) {
                const ratio = (halfLength - accumulated) / lengths[i];
                const p1 = coords[i];
                const p2 = coords[i + 1];
                return [
                    p1[0] + ratio * (p2[0] - p1[0]),
                    p1[1] + ratio * (p2[1] - p1[1]),
                    (p1[2] || 0) + ratio * ((p2[2] || 0) - (p1[2] || 0)),
                ];
            }
            accumulated += lengths[i];
        }
        return coords[Math.floor(coords.length / 2)];
    }

    _getLabelPosition(geom) {
        if (!geom || !geom.coordinates) return null;
        if (geom.type === "Point") {
            return Cesium.Cartesian3.fromDegrees(
                geom.coordinates[0],
                geom.coordinates[1],
                geom.coordinates[2] || 0,
            );
        } else if (geom.type === "MultiPoint") {
            if (geom.coordinates.length > 0) {
                const first = geom.coordinates[0];
                return Cesium.Cartesian3.fromDegrees(first[0], first[1], first[2] || 0);
            }
        } else if (geom.type === "LineString") {
            const mid = this._getLineStringMidpoint(geom.coordinates);
            if (mid) return Cesium.Cartesian3.fromDegrees(mid[0], mid[1], mid[2] || 0);
        } else if (geom.type === "MultiLineString") {
            if (geom.coordinates.length > 0) {
                const firstLine = geom.coordinates[0];
                const mid = this._getLineStringMidpoint(firstLine);
                if (mid) return Cesium.Cartesian3.fromDegrees(mid[0], mid[1], mid[2] || 0);
            }
        } else if (geom.type === "Polygon") {
            const exteriorCoords = geom.coordinates[0];
            if (exteriorCoords && exteriorCoords.length > 0) {
                let sumLon = 0,
                    sumLat = 0,
                    sumAlt = 0;
                for (const coord of exteriorCoords) {
                    sumLon += coord[0];
                    sumLat += coord[1];
                    sumAlt += coord[2] || 0;
                }
                return Cesium.Cartesian3.fromDegrees(
                    sumLon / exteriorCoords.length,
                    sumLat / exteriorCoords.length,
                    sumAlt / exteriorCoords.length,
                );
            }
        } else if (geom.type === "MultiPolygon") {
            if (
                geom.coordinates.length > 0 &&
                geom.coordinates[0][0] &&
                geom.coordinates[0][0].length > 0
            ) {
                const exteriorCoords = geom.coordinates[0][0];
                let sumLon = 0,
                    sumLat = 0,
                    sumAlt = 0;
                for (const coord of exteriorCoords) {
                    sumLon += coord[0];
                    sumLat += coord[1];
                    sumAlt += coord[2] || 0;
                }
                return Cesium.Cartesian3.fromDegrees(
                    sumLon / exteriorCoords.length,
                    sumLat / exteriorCoords.length,
                    sumAlt / exteriorCoords.length,
                );
            }
        }
        return null;
    }

    _getDxfFeatureColor(properties, categoryColor) {
        if (!properties) return categoryColor;

        if (properties.rawcolor || properties.RawColor) {
            return properties.rawcolor || properties.RawColor;
        }

        const subClasses = properties.subclasses || properties.SubClasses;
        if (subClasses) {
            const parts = subClasses.split(":");
            const specificClass = parts[parts.length - 1];
            if (DXF_SUBCLASS_COLORS[specificClass]) {
                return DXF_SUBCLASS_COLORS[specificClass];
            }
        }

        return categoryColor;
    }

    _handlePointGeom(
        geom,
        feature,
        pointCollection,
        entityCollection,
        categoryIconUrl,
        isDxfData,
        featureColor,
        allPositions,
    ) {
        const pos = Cesium.Cartesian3.fromDegrees(
            geom.coordinates[0],
            geom.coordinates[1],
            geom.coordinates[2] || 0,
        );
        if (categoryIconUrl && !isDxfData) {
            const entity = this.viewer.entities.add({
                position: pos,
                billboard: {
                    image: categoryIconUrl,
                    width: 20,
                    height: 20,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance: CONFIG.SCALE_BY_DISTANCE,
                },
                properties: feature.properties,
            });
            entityCollection.push(entity);
        } else {
            pointCollection.add({
                position: pos,
                color: Cesium.Color.fromCssColorString(featureColor),
                pixelSize: isDxfData ? 6 : 7,
                id: feature.properties,
                scaleByDistance: CONFIG.SCALE_BY_DISTANCE,
            });
        }
        allPositions.push(pos);
    }

    _handleMultiPointGeom(
        geom,
        feature,
        pointCollection,
        entityCollection,
        categoryIconUrl,
        isDxfData,
        multiPtColor,
        allPositions,
    ) {
        geom.coordinates.forEach((coord) => {
            const pos = Cesium.Cartesian3.fromDegrees(coord[0], coord[1], coord[2] || 0);
            if (categoryIconUrl && !isDxfData) {
                const entity = this.viewer.entities.add({
                    position: pos,
                    billboard: {
                        image: categoryIconUrl,
                        width: 20,
                        height: 20,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        scaleByDistance: CONFIG.SCALE_BY_DISTANCE,
                    },
                    properties: feature.properties,
                });
                entityCollection.push(entity);
            } else {
                pointCollection.add({
                    position: pos,
                    color: Cesium.Color.fromCssColorString(multiPtColor),
                    pixelSize: isDxfData ? 6 : 7,
                    id: feature.properties,
                    scaleByDistance: CONFIG.SCALE_BY_DISTANCE,
                });
            }
            allPositions.push(pos);
        });
    }

    _handleLineStringGeom(geom, feature, polylineInstances, isDxfData, lineColor, allPositions) {
        const coords = geom.coordinates.flat();
        if (coords.length >= 4) {
            const is3D = geom.coordinates[0] && geom.coordinates[0].length === 3;
            const positions = is3D
                ? Cesium.Cartesian3.fromDegreesArrayHeights(coords)
                : Cesium.Cartesian3.fromDegreesArray(coords);

            polylineInstances.push(
                new Cesium.GeometryInstance({
                    geometry: new Cesium.PolylineGeometry({
                        positions: positions,
                        width: isDxfData ? 1.5 : 2.0,
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            Cesium.Color.fromCssColorString(lineColor).withAlpha(
                                isDxfData ? 1.4 : 1.0,
                            ),
                        ),
                    },
                    id: feature.properties,
                }),
            );
            allPositions.push(...positions);
        }
    }

    _handleMultiLineStringGeom(
        geom,
        feature,
        polylineInstances,
        isDxfData,
        multiLineColor,
        allPositions,
    ) {
        geom.coordinates.forEach((lineCoords) => {
            const coords = lineCoords.flat();
            if (coords.length >= 4) {
                const is3D = lineCoords[0] && lineCoords[0].length === 3;
                const positions = is3D
                    ? Cesium.Cartesian3.fromDegreesArrayHeights(coords)
                    : Cesium.Cartesian3.fromDegreesArray(coords);

                polylineInstances.push(
                    new Cesium.GeometryInstance({
                        geometry: new Cesium.PolylineGeometry({
                            positions: positions,
                            width: isDxfData ? 1.5 : 2.0,
                        }),
                        attributes: {
                            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                                Cesium.Color.fromCssColorString(multiLineColor).withAlpha(
                                    isDxfData ? 1.4 : 1.0,
                                ),
                            ),
                        },
                        id: feature.properties,
                    }),
                );
                allPositions.push(...positions);
            }
        });
    }

    _handlePolygonGeom(geom, feature, polygonInstances, polyColor, allPositions) {
        const hierarchy = this._createPolygonHierarchy(geom.coordinates);
        polygonInstances.push(
            new Cesium.GeometryInstance({
                geometry: new Cesium.PolygonGeometry({
                    polygonHierarchy: hierarchy,
                    perPositionHeight: true,
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                        Cesium.Color.fromCssColorString(polyColor).withAlpha(0.4),
                    ),
                },
                id: feature.properties,
            }),
        );
        allPositions.push(...hierarchy.positions);
    }

    _handleMultiPolygonGeom(geom, feature, polygonInstances, multiPolyColor, allPositions) {
        geom.coordinates.forEach((polyCoords) => {
            const hierarchy = this._createPolygonHierarchy(polyCoords);
            polygonInstances.push(
                new Cesium.GeometryInstance({
                    geometry: new Cesium.PolygonGeometry({
                        polygonHierarchy: hierarchy,
                        perPositionHeight: true,
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            Cesium.Color.fromCssColorString(multiPolyColor).withAlpha(0.4),
                        ),
                    },
                    id: feature.properties,
                }),
            );
            allPositions.push(...hierarchy.positions);
        });
    }

    _handleLabel(geom, feature, labelCollection, labelFieldName = "") {
        if (!labelFieldName) return;
        const labelValue =
            feature.properties &&
            (feature.properties[labelFieldName] !== undefined
                ? feature.properties[labelFieldName]
                : feature.properties[labelFieldName.toLowerCase()]);
        if (labelValue !== undefined && labelValue !== null) {
            const labelStr = String(labelValue).trim();
            if (labelStr.length > 0) {
                const labelPos = this._getLabelPosition(geom);
                if (labelPos) {
                    const hasAlt = this._hasAltitudeValue(geom);
                    const heightRef = hasAlt
                        ? Cesium.HeightReference.NONE
                        : Cesium.HeightReference.CLAMP_TO_GROUND;
                    const isPoint = geom.type === "Point" || geom.type === "MultiPoint";

                    labelCollection.add({
                        position: labelPos,
                        text: labelStr,
                        font: "bold 11px Inter, Roboto, sans-serif",
                        fillColor: Cesium.Color.WHITE,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        showBackground: true,
                        backgroundColor: new Cesium.Color(0.1, 0.1, 0.1, 0.7),
                        backgroundPadding: new Cesium.Cartesian2(6, 4),
                        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                        verticalOrigin: isPoint
                            ? Cesium.VerticalOrigin.TOP
                            : Cesium.VerticalOrigin.CENTER,
                        pixelOffset: isPoint
                            ? new Cesium.Cartesian2(0, 10)
                            : new Cesium.Cartesian2(0, 0),
                        heightReference: heightRef,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        scaleByDistance: CONFIG.SCALE_BY_DISTANCE,
                        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(
                            1500.0,
                            1.0,
                            3000.0,
                            0.2,
                        ),
                    });
                }
            }
        }
    }

    async loadVector(layerId, url, style = {}) {
        if (this.activeVectorLayers.has(layerId)) {
            const data = this.activeVectorLayers.get(layerId);
            const collections = data.collections || data; // fallback for older structure
            collections.forEach((c) => (c.show = !c.show));
            this.viewer.scene.requestRender();
            this._publishVisibleVectors();
            return collections[0].show;
        }

        try {
            const response = await fetch(url);
            if (!response.ok)
                throw new Error(`Network response was not ok: ${response.statusText}`);
            const data = await response.json();

            const pointCollection = new Cesium.PointPrimitiveCollection({
                blendOption: Cesium.BlendOption.OPAQUE,
            });
            const entityCollection = []; // For Billboard entities (icons)
            const labelCollection = new Cesium.LabelCollection();

            const polylineInstances = [];
            const polygonInstances = [];
            const features = data.features || [];
            const batchSize = 2000;
            const allPositions = [];
            const vertexIndex = new VectorVertexIndex();

            const categoryColor = style.color || "#3b82f6";
            const categoryIconUrl = style.iconUrl || null;

            // Check if this dataset has DXF properties (for point styling)
            const isDxfData =
                features.length > 0 &&
                features[0].properties &&
                (features[0].properties.SubClasses ||
                    features[0].properties.subclasses ||
                    features[0].properties.RawColor ||
                    features[0].properties.rawcolor);

            for (let i = 0; i < features.length; i++) {
                const feature = features[i];
                const geom = feature.geometry;
                if (!geom) continue;
                vertexIndex.addGeometry(geom);

                const featureColor = this._getDxfFeatureColor(feature.properties, categoryColor);

                if (geom.type === "Point") {
                    this._handlePointGeom(
                        geom,
                        feature,
                        pointCollection,
                        entityCollection,
                        categoryIconUrl,
                        isDxfData,
                        featureColor,
                        allPositions,
                    );
                } else if (geom.type === "MultiPoint") {
                    this._handleMultiPointGeom(
                        geom,
                        feature,
                        pointCollection,
                        entityCollection,
                        categoryIconUrl,
                        isDxfData,
                        featureColor,
                        allPositions,
                    );
                } else if (geom.type === "LineString") {
                    this._handleLineStringGeom(
                        geom,
                        feature,
                        polylineInstances,
                        isDxfData,
                        featureColor,
                        allPositions,
                    );
                } else if (geom.type === "MultiLineString") {
                    this._handleMultiLineStringGeom(
                        geom,
                        feature,
                        polylineInstances,
                        isDxfData,
                        featureColor,
                        allPositions,
                    );
                } else if (geom.type === "Polygon") {
                    this._handlePolygonGeom(
                        geom,
                        feature,
                        polygonInstances,
                        featureColor,
                        allPositions,
                    );
                } else if (geom.type === "MultiPolygon") {
                    this._handleMultiPolygonGeom(
                        geom,
                        feature,
                        polygonInstances,
                        featureColor,
                        allPositions,
                    );
                }

                // Check for configurable label property to add labels on map
                const labelFieldName = style.labelField !== undefined ? style.labelField : "";
                if (labelFieldName) {
                    this._handleLabel(geom, feature, labelCollection, labelFieldName);
                }

                if (i % batchSize === 0 && i > 0) {
                    await new Promise((r) => setTimeout(r, 0));
                }
            }

            await vertexIndex.build();
            this.viewer.scene.primitives.add(pointCollection);

            let polylinePrimitive = null;
            if (polylineInstances.length > 0) {
                polylinePrimitive = new Cesium.Primitive({
                    geometryInstances: polylineInstances,
                    appearance: new Cesium.PolylineColorAppearance(),
                });
                this.viewer.scene.primitives.add(polylinePrimitive);
            }

            let polygonPrimitive = null;
            if (polygonInstances.length > 0) {
                polygonPrimitive = new Cesium.Primitive({
                    geometryInstances: polygonInstances,
                    appearance: new Cesium.PerInstanceColorAppearance({
                        flat: true,
                    }),
                });
                this.viewer.scene.primitives.add(polygonPrimitive);
            }

            const result = [pointCollection];
            if (polylinePrimitive) result.push(polylinePrimitive);
            if (polygonPrimitive) result.push(polygonPrimitive);
            if (labelCollection.length > 0) {
                this.viewer.scene.primitives.add(labelCollection);
                result.push(labelCollection);
            }

            // Custom wrapper for entities to have a .show property
            if (entityCollection.length > 0) {
                const entityWrapper = {
                    get show() {
                        return entityCollection.length > 0 ? entityCollection[0].show : false;
                    },
                    set show(value) {
                        entityCollection.forEach((e) => (e.show = value));
                    },
                };
                result.push(entityWrapper);
            }

            if (allPositions.length > 0) {
                result.boundingSphere = Cesium.BoundingSphere.fromPoints(allPositions);
            }

            this.activeVectorLayers.set(layerId, {
                collections: result,
                entities: entityCollection,
                style: style,
                geojsonData: data,
                vertexIndex,
            });
            this.viewer.scene.requestRender();
            this._publishVisibleVectors();

            return true;
        } catch (error) {
            console.error("CesiumMapController: Vector Load Error", error);
            throw error;
        }
    }

    /**
     * Permanently remove a loaded vector layer (primitives, labels and billboard entities) from the scene.
     */
    removeVectorLayer(layerId) {
        const data = this.activeVectorLayers.get(layerId);
        if (!data) return;

        (data.collections || []).forEach((collection) => {
            if (this.viewer.scene.primitives.contains(collection)) {
                this.viewer.scene.primitives.remove(collection);
            }
        });
        (data.entities || []).forEach((entity) => this.viewer.entities.remove(entity));

        this.activeVectorLayers.delete(layerId);
        this._publishVisibleVectors();
        this.hideFeatureProperties();
        this.viewer.scene.requestRender();
    }

    zoomToVector(layerId) {
        const collections = this.activeVectorLayers.get(layerId);
        if (collections && collections.boundingSphere) {
            this.viewer.camera.flyToBoundingSphere(collections.boundingSphere, {
                duration: 2,
            });
        }
    }

    getVectorPropertyKeys(layerId) {
        const layer = this.activeVectorLayers.get(layerId);
        if (!layer || !layer.geojsonData || !layer.geojsonData.features) return [];

        const firstWithProps = layer.geojsonData.features.find((f) => f.properties);
        if (firstWithProps) {
            return Object.keys(firstWithProps.properties);
        }
        return [];
    }

    changeVectorLabelField(layerId, newLabelField) {
        const layer = this.activeVectorLayers.get(layerId);
        if (!layer || !layer.geojsonData) return;

        const collections = layer.collections || [];

        // 1. Find and remove old LabelCollection
        const oldLabelColIndex = collections.findIndex((c) => c instanceof Cesium.LabelCollection);
        if (oldLabelColIndex !== -1) {
            const oldLabelCollection = collections[oldLabelColIndex];
            this.viewer.scene.primitives.remove(oldLabelCollection);
            collections.splice(oldLabelColIndex, 1);
        }

        // 2. Add new LabelCollection if a field is selected
        if (newLabelField) {
            const labelCollection = new Cesium.LabelCollection();
            const features = layer.geojsonData.features || [];

            features.forEach((feature) => {
                const geom = feature.geometry;
                if (geom) {
                    this._handleLabel(geom, feature, labelCollection, newLabelField);
                }
            });

            if (labelCollection.length > 0) {
                this.viewer.scene.primitives.add(labelCollection);
                collections.push(labelCollection);
            }
        }

        // 3. Keep style reference updated
        if (!layer.style) layer.style = {};
        layer.style.labelField = newLabelField;

        this.viewer.scene.requestRender();
    }

    _createPolygonHierarchy(coordinates) {
        // coordinates[0] is the exterior ring, others are holes
        return {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(coordinates[0].flat()),
            holes: coordinates.slice(1).map((hole) => ({
                positions: Cesium.Cartesian3.fromDegreesArrayHeights(hole.flat()),
            })),
        };
    }

    enableCoordinatePickerMode() {
        this.disableAllMeasureModes();
        this.coordPickerMode = true;
        this.viewer.canvas.style.cursor = "crosshair";

        const btn = document.getElementById("coordinatePickerBtn");
        if (btn) {
            applyBtnStyle(btn, "active");
        }

        if (!this._coordPickerClickHandler) {
            this._coordPickerClickHandler = new Cesium.ScreenSpaceEventHandler(
                this.viewer.scene.canvas,
            );
        }

        // LEFT_CLICK: Pick coordinate (with snapping)
        this._coordPickerClickHandler.setInputAction((movement) => {
            const snapped = this.findNearestVectorVertex(movement.position);
            let cartesian;
            if (snapped) {
                cartesian = snapped.cartesian;
            } else {
                cartesian = this._pickGlobePosition(movement.position);
            }
            const coords = cartesianToCoords(cartesian);
            if (snapped && coords) {
                coords.latitude = snapped.latitude;
                coords.longitude = snapped.longitude;
                if (snapped.altitude !== null) {
                    coords.altitude = snapped.altitude;
                }
            }

            if (coords) {
                this.showCoordinatePickerTempPin(
                    coords.latitude,
                    coords.longitude,
                    coords.altitude,
                );

                const panel = document.getElementById("coordinatePickerPopup");
                if (panel) {
                    panel.classList.remove("hidden");

                    document.getElementById("pickLatVal").textContent = coords.latitude.toFixed(6);
                    document.getElementById("pickLngVal").textContent = coords.longitude.toFixed(6);
                    document.getElementById("pickZVal").textContent =
                        coords.altitude !== null ? `${coords.altitude.toFixed(2)} m` : "-";

                    const utmXEl = document.getElementById("pickUtmXVal");
                    const utmYEl = document.getElementById("pickUtmYVal");
                    if (utmXEl) utmXEl.textContent = coords.utmX.toFixed(4);
                    if (utmYEl) utmYEl.textContent = coords.utmY.toFixed(4);
                }
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // MOUSE_MOVE: Update snap indicator in coordinate picker mode (throttled)
        let _snapThrottleTimer = null;
        this._coordPickerClickHandler.setInputAction((movement) => {
            if (_snapThrottleTimer) return; // skip if throttle active
            _snapThrottleTimer = setTimeout(() => {
                _snapThrottleTimer = null;
            }, 60);
            const snapped = this.findNearestVectorVertex(movement.endPosition);
            if (snapped) {
                this.updateSnapIndicator(snapped.cartesian);
            } else {
                this.hideSnapIndicator();
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    }

    disableCoordinatePickerMode() {
        this.coordPickerMode = false;
        this.viewer.canvas.style.cursor = "default";

        const btn = document.getElementById("coordinatePickerBtn");
        if (btn) {
            applyBtnStyle(btn, "inactive");
        }

        if (this._coordPickerClickHandler) {
            this._coordPickerClickHandler.destroy();
            this._coordPickerClickHandler = null;
        }
        this.removeCoordinatePickerTempPin();
        const panel = document.getElementById("coordinatePickerPopup");
        if (panel) panel.classList.add("hidden");
        this.hideSnapIndicator();
    }
    /**
     * Find the closest vertex using each visible layer's spatial index.
     * @param {Cesium.Cartesian2} screenPosition - The cursor position.
     * @param {number} maxPixelDistance - Snapping tolerance in CSS pixels.
     * @returns {object|null} The snapped vertex, preserving the source coordinates.
     */
    findNearestVectorVertex(screenPosition, maxPixelDistance = 15) {
        return findNearestIndexedVertex(
            this.viewer,
            this.activeVectorLayers.values(),
            screenPosition,
            maxPixelDistance,
        );
    }

    /**
     * Updates the snap indicator position and shows it.
     * @param {Cesium.Cartesian3} position - The snapped position.
     */
    updateSnapIndicator(position) {
        if (!this.viewer) return;

        if (!this._snapIndicatorEntity) {
            this._snapIndicatorEntity = this.viewer.entities.add({
                name: "Snap Indicator",
                position: position,
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
        } else {
            this._snapIndicatorEntity.position = position;
            this._snapIndicatorEntity.show = true;
        }
        this.viewer.scene.requestRender();
    }

    /**
     * Hides the snap indicator.
     */
    hideSnapIndicator() {
        if (this._snapIndicatorEntity) {
            this._snapIndicatorEntity.show = false;
            if (this.viewer) {
                this.viewer.scene.requestRender();
            }
        }
    }

    /**
     * Great-circle distance in meters between two WGS84 positions (used by geolocation tracking).
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const geodesic = new Cesium.EllipsoidGeodesic(
            Cesium.Cartographic.fromDegrees(lon1, lat1),
            Cesium.Cartographic.fromDegrees(lon2, lat2),
        );
        return geodesic.surfaceDistance;
    }

    _addTempEntity(
        stateKey,
        name,
        lat,
        lng,
        alt,
        color,
        size,
        icon = "map-pin",
        isImage = false,
    ) {
        this._removeTempEntity(stateKey);
        const position = Cesium.Cartesian3.fromDegrees(lng, lat, alt !== null ? alt : 0);
        const billboardImage =
            isImage && icon ? icon : CesiumMapController.resolveBillboardImage(icon, color, size);

        this[stateKey] = this.viewer.entities.add({
            name: name,
            position: position,
            billboard: {
                image: billboardImage,
                width: size,
                height: size,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                heightReference: CesiumMapController.heightRef(alt !== null),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: CONFIG.SCALE_BY_DISTANCE,
            },
        });
        this.viewer.scene.requestRender();
    }

    _removeTempEntity(stateKey) {
        if (this[stateKey]) {
            this.viewer.entities.remove(this[stateKey]);
            this[stateKey] = null;
            this.viewer.scene.requestRender();
        }
    }

    showCoordinatePickerTempPin(lat, lng, alt = null) {
        this._addTempEntity(
            "_coordPickerTempEntity",
            "Picked Location",
            lat,
            lng,
            alt,
            "#f97316",
            32,
        );
    }

    removeCoordinatePickerTempPin() {
        this._removeTempEntity("_coordPickerTempEntity");
    }



    /**
     * Retrieves the clamping behavior for drawn entities based on terrain availability.
     * @returns {boolean} True if drawing should clamp to ground.
     */
    _drawClampToGround() {
        return this._isTerrainAvailable();
    }

    /**
     * Retrieves the classification type for drawn entities (TERRAIN or BOTH).
     * @returns {Cesium.ClassificationType} The classification type.
     */
    _drawClassificationType() {
        return this._isTerrainAvailable()
            ? Cesium.ClassificationType.TERRAIN
            : Cesium.ClassificationType.BOTH;
    }

    /**
     * Interpolates the height of a point inside the polygon using Inverse Distance Weighting (IDW).
     * @param {number} lon - The longitude of the point in degrees.
     * @param {number} lat - The latitude of the point in degrees.
     * @param {Cesium.Cartesian3[]} verticesCartesian - The vertices of the polygon.
     * @returns {number} The interpolated height in meters.
     */
    _interpolatePolygonHeight(lon, lat, verticesCartesian) {
        if (!verticesCartesian || verticesCartesian.length === 0) return 0;

        const vertices = verticesCartesian.map((v) => {
            const carto = Cesium.Cartographic.fromCartesian(v);
            return {
                lon: Cesium.Math.toDegrees(carto.longitude),
                lat: Cesium.Math.toDegrees(carto.latitude),
                height: carto.height || 0,
            };
        });

        // If the point is extremely close to a vertex, return that vertex's height directly
        for (const v of vertices) {
            const d = Math.sqrt((lon - v.lon) ** 2 + (lat - v.lat) ** 2);
            if (d < 1e-7) {
                return v.height;
            }
        }

        let numerator = 0;
        let denominator = 0;
        for (const v of vertices) {
            const d = Math.sqrt((lon - v.lon) ** 2 + (lat - v.lat) ** 2);
            const w = 1 / (d * d); // Inverse distance squared weight
            numerator += w * v.height;
            denominator += w;
        }

        return numerator / denominator;
    }

    _createMeasureOptions() {
        return {
            // Drawers snap to the vertices of the loaded vector layers through this controller.
            snapProvider: this,
            onEnd: () => {
                this.hideDrawingControlBar("measure");
            },
        };
    }

    closeMeasurePanel() {
        const measurePanel = document.getElementById("measurePanel");
        if (measurePanel) {
            measurePanel.classList.add("opacity-0", "pointer-events-none", "scale-95");
        }
    }

    enableDistanceMeasureMode() {
        this.disableAllMeasureModes();
        this.disableCoordinatePickerMode();
        this.closeMeasurePanel();

        this.activeMeasureMode = "distance";
        if (!this.distanceMeasure) {
            this.distanceMeasure = new DistanceMeasure(this.viewer, this._createMeasureOptions());
        }
        this.distanceMeasure.start();
        this._updateMeasureUI();
        this.showDrawingControlBar("Click points to measure planar distance", "measure");
    }

    enableDistanceSurfaceMeasureMode() {
        this.disableAllMeasureModes();
        this.disableCoordinatePickerMode();
        this.closeMeasurePanel();

        this.activeMeasureMode = "distance_surface";
        if (!this.distanceSurfaceMeasure) {
            this.distanceSurfaceMeasure = new DistanceSurfaceMeasure(
                this.viewer,
                this._createMeasureOptions(),
            );
        }
        this.distanceSurfaceMeasure.start();
        this._updateMeasureUI();
        this.showDrawingControlBar("Click points to measure surface distance", "measure");
    }

    enableAreaMeasureMode() {
        this.disableAllMeasureModes();
        this.disableCoordinatePickerMode();
        this.closeMeasurePanel();

        this.activeMeasureMode = "area";
        if (!this.areaMeasure) {
            this.areaMeasure = new AreaMeasure(this.viewer, this._createMeasureOptions());
        }
        this.areaMeasure.start();
        this._updateMeasureUI();
        this.showDrawingControlBar("Click points to measure planar area", "measure");
    }

    enableAreaSurfaceMeasureMode() {
        this.disableAllMeasureModes();
        this.disableCoordinatePickerMode();
        this.closeMeasurePanel();

        this.activeMeasureMode = "area_surface";
        if (!this.areaSurfaceMeasure) {
            this.areaSurfaceMeasure = new AreaSurfaceMeasure(
                this.viewer,
                this._createMeasureOptions(),
            );
        }
        this.areaSurfaceMeasure.start();
        this._updateMeasureUI();
        this.showDrawingControlBar("Click points to measure surface area", "measure");
    }

    enableCircleMeasureMode() {
        this.disableAllMeasureModes();
        this.disableCoordinatePickerMode();
        this.closeMeasurePanel();

        this.activeMeasureMode = "circle";
        if (!this.circleMeasure) {
            this.circleMeasure = new CircleMeasure(this.viewer, this._createMeasureOptions());
        }
        this.circleMeasure.start();
        this._updateMeasureUI();
        this.showDrawingControlBar("Click the center, then the radius", "measure");
    }

    disableAllMeasureModes() {
        if (this.pivotMode && !this._pivotCameraLocked) {
            this._disablePivotMode();
        }
        if (this.distanceMeasure) {
            this.distanceMeasure.end();
        }
        if (this.distanceSurfaceMeasure) {
            this.distanceSurfaceMeasure.end();
        }
        if (this.areaMeasure) {
            this.areaMeasure.end();
        }
        if (this.areaSurfaceMeasure) {
            this.areaSurfaceMeasure.end();
        }
        if (this.circleMeasure) {
            this.circleMeasure.end();
        }
        if (this.activeMeasureMode === "cut_fill") {
            this.disableCutFillMode();
        }
        if (this.activeMeasureMode === "profile") {
            this.disableProfileMode();
        }
        this.activeMeasureMode = null;
        this._updateMeasureUI();
        this.hideDrawingControlBar("measure");
        this.viewer?.scene.requestRender();
    }

    toggleDistanceMeasure() {
        if (this.activeMeasureMode === "distance") {
            this.disableAllMeasureModes();
        } else {
            this.enableDistanceMeasureMode();
        }
    }

    toggleDistanceSurfaceMeasure() {
        if (this.activeMeasureMode === "distance_surface") {
            this.disableAllMeasureModes();
        } else {
            this.enableDistanceSurfaceMeasureMode();
        }
    }

    toggleAreaMeasure() {
        if (this.activeMeasureMode === "area") {
            this.disableAllMeasureModes();
        } else {
            this.enableAreaMeasureMode();
        }
    }

    toggleAreaSurfaceMeasure() {
        if (this.activeMeasureMode === "area_surface") {
            this.disableAllMeasureModes();
        } else {
            this.enableAreaSurfaceMeasureMode();
        }
    }

    toggleCircleMeasure() {
        if (this.activeMeasureMode === "circle") {
            this.disableAllMeasureModes();
        } else {
            this.enableCircleMeasureMode();
        }
    }

    _updateMeasureUI() {
        const distHorizBtn = document.getElementById("measureDistanceHorizBtn");
        const distSurfBtn = document.getElementById("measureDistanceSurfBtn");
        const areaHorizBtn = document.getElementById("measureAreaHorizBtn");
        const areaSurfBtn = document.getElementById("measureAreaSurfBtn");
        const circleBtn = document.getElementById("measureCircleBtn");
        const cutFillBtn = document.getElementById("measureAnalysisBtn");

        const updateBtnClass = (btn, isActive) => {
            if (!btn) return;
            applyBtnStyle(btn, isActive ? "active" : "inactive");
        };

        updateBtnClass(distHorizBtn, this.activeMeasureMode === "distance");
        updateBtnClass(distSurfBtn, this.activeMeasureMode === "distance_surface");
        updateBtnClass(areaHorizBtn, this.activeMeasureMode === "area");
        updateBtnClass(areaSurfBtn, this.activeMeasureMode === "area_surface");
        updateBtnClass(circleBtn, this.activeMeasureMode === "circle");
        updateBtnClass(
            cutFillBtn,
            ["cut_fill", "profile"].includes(this.activeMeasureMode),
        );
    }

    initCutFillPanelUI() {
        const cutFillDrawBtn = document.getElementById("cutFillDrawBtn");
        const cutFillDrawBtnText = document.getElementById("cutFillDrawBtnText");
        const cutFillClearBtn = document.getElementById("cutFillClearBtn");
        const cutFillCalcBtn = document.getElementById("cutFillCalculateBtn");
        const closeBtn = document.getElementById("closeAnalysisBtn");

        const toggleHeatmap = document.getElementById("cutFillToggleHeatmap");
        const togglePoints = document.getElementById("cutFillTogglePoints");

        const targetType = document.getElementById("cutFillTargetType");
        const flatGroup = document.getElementById("cutFillFlatGroup");
        const terrainGroup = document.getElementById("cutFillTerrainGroup");
        const boundaryOffsetGroup = document.getElementById("cutFillBoundaryOffsetGroup");

        if (targetType && flatGroup && terrainGroup && boundaryOffsetGroup) {
            targetType.onchange = (e) => {
                const type = e.target.value;
                if (type === "flat") {
                    flatGroup.classList.remove("hidden");
                    terrainGroup.classList.add("hidden");
                    boundaryOffsetGroup.classList.add("hidden");
                } else if (type === "boundary") {
                    flatGroup.classList.add("hidden");
                    terrainGroup.classList.add("hidden");
                    boundaryOffsetGroup.classList.remove("hidden");
                } else {
                    flatGroup.classList.add("hidden");
                    terrainGroup.classList.remove("hidden");
                    boundaryOffsetGroup.classList.add("hidden");
                    this.fetchComparisonTerrains(
                        "cutFillCompareTerrain",
                        "cutFillCompareTerrainSpinner",
                    );
                }
                this.updateCutFillVisuals();
            };
        }

        const boundaryOffsetInput = document.getElementById("cutFillBoundaryOffset");
        if (boundaryOffsetInput) {
            boundaryOffsetInput.addEventListener("input", () => {
                this.updateCutFillVisuals();
            });
        }

        if (cutFillDrawBtn) {
            cutFillDrawBtn.onclick = () => {
                if (this.activeDrawer && this.cutFillMode) {
                    this.disableCutFillDrawMode();
                } else {
                    this.enableCutFillDrawMode();
                    if (cutFillDrawBtnText) cutFillDrawBtnText.textContent = "Cancel drawing";
                    applyBtnStyle(cutFillDrawBtn, "danger");
                }
            };
        }

        if (cutFillClearBtn) {
            cutFillClearBtn.onclick = () => this.clearCutFill();
        }

        if (cutFillCalcBtn) {
            cutFillCalcBtn.onclick = () => this.calculateVolume();
        }

        if (closeBtn) {
            closeBtn.onclick = () => {
                this.disableCutFillMode();
                this.disableProfileMode();
            };
        }


        this.initDrawingControlBar();

        if (toggleHeatmap) {
            toggleHeatmap.onchange = (e) => {
                const show = e.target.checked;
                if (this.cutFillHeatmapEntity) {
                    this.cutFillHeatmapEntity.show = show;
                }
                if (this.cutFillPrimitive) {
                    this.cutFillPrimitive.show = show;
                }
                this.cutFillHeatmapEntities.forEach((ent) => {
                    ent.show = show;
                });
                this.viewer.scene.requestRender();
            };
        }

        if (togglePoints) {
            togglePoints.onchange = (e) => {
                const show = e.target.checked;
                if (this.cutFillPointsCollection) {
                    this.cutFillPointsCollection.show = show;
                }
                this.cutFillPointEntities.forEach((ent) => {
                    ent.show = show;
                });
                this.viewer.scene.requestRender();
            };
        }
    }

    async fetchComparisonTerrains(targetId = "", spinnerId = "", limit = 30) {
        const select = document.getElementById(targetId);
        const spinner = document.getElementById(spinnerId);
        if (!select) return;

        if (this.comparisonTerrainLayers && this.comparisonTerrainLayers.length > 0) {
            this._populateCompareTerrainDropdown(targetId);
            return;
        }

        if (spinner) spinner.classList.remove("hidden");
        select.innerHTML = '<option value="">Loading terrains...</option>';

        try {
            const res = await fetch(`/geodata/layers/terrain?limit=${limit}`);
            const data = await res.json();
            if (data.success && data.layers) {
                this.comparisonTerrainLayers = data.layers;
                this._populateCompareTerrainDropdown(targetId);
            } else {
                select.innerHTML = '<option value="">Failed to load terrain list</option>';
            }
        } catch (err) {
            console.error("Error fetching comparison terrains:", err);
            select.innerHTML = '<option value="">Failed to load terrain list</option>';
        } finally {
            if (spinner) spinner.classList.add("hidden");
        }
    }

    _populateCompareTerrainDropdown(targetId = "") {
        const select = document.getElementById(targetId);
        if (!select) return;

        select.innerHTML = "";

        // Filter out currently active terrain layer
        const activeLayerId = this.loadedTerrainId ? String(this.loadedTerrainId) : null;
        const availableLayers = this.comparisonTerrainLayers.filter(
            (l) => String(l.id) !== activeLayerId,
        );

        if (availableLayers.length === 0) {
            select.innerHTML = '<option value="">No terrain layers available</option>';
            return;
        }

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "-- Select terrain --";
        select.appendChild(placeholder);

        availableLayers.forEach((layer) => {
            const opt = document.createElement("option");
            opt.value = layer.terrain_detail ? layer.terrain_detail.tileset_url : "";
            opt.textContent = `${layer.name} (${layer.terrain_detail?.acquisition_date || "N/A"})`;
            select.appendChild(opt);
        });
    }

    toggleAnalysisMode() {
        const panel = document.getElementById("analysisPanel");
        if (!panel) return;

        const isActive = panel.classList.contains("active");
        if (isActive) {
            this.disableCutFillMode();
            this.disableProfileMode();
        } else {
            // Disable all other modes first
            this.disableAllMeasureModes();
            this.disableCoordinatePickerMode();

            // Resume whichever tab was last selected
            const selectedTab = panel.querySelector('[role="tab"][aria-selected="true"]')?.id;
            this.activeMeasureMode =
                { "profile-section-tab-btn": "profile" }[selectedTab] ||
                "cut_fill";
            this._updateMeasureUI();

            // Show panel
            panel.classList.add("active");

            // Close measure panel if open
            this.closeMeasurePanel();
        }
    }

    showDrawingControlBar(text, context, showUndo = false) {
        this._drawingControlContext = context;
        const bar = document.getElementById("drawingControlBar");
        const barText = document.getElementById("drawingControlBarText");
        const undoBtn = document.getElementById("drawingControlUndoBtn");
        const finishPartBtn = document.getElementById("drawingControlFinishPartBtn");
        if (bar) bar.classList.remove("hidden");
        if (barText) barText.textContent = text || "Drawing...";
        if (undoBtn) {
            if (showUndo) {
                undoBtn.classList.remove("hidden");
            } else {
                undoBtn.classList.add("hidden");
            }
        }
        if (finishPartBtn) finishPartBtn.classList.add("hidden");
    }

    hideDrawingControlBar(context) {
        // Only hide if the context matches (avoid hiding bar when a different mode is active)
        if (context && this._drawingControlContext !== context) return;
        this._drawingControlContext = null;
        const bar = document.getElementById("drawingControlBar");
        const undoBtn = document.getElementById("drawingControlUndoBtn");
        const finishPartBtn = document.getElementById("drawingControlFinishPartBtn");
        if (bar) bar.classList.add("hidden");
        if (undoBtn) undoBtn.classList.add("hidden");
        if (finishPartBtn) finishPartBtn.classList.add("hidden");
    }

    _getActiveMeasureInstance() {
        switch (this.activeMeasureMode) {
            case "distance":
                return this.distanceMeasure;
            case "distance_surface":
                return this.distanceSurfaceMeasure;
            case "area":
                return this.areaMeasure;
            case "area_surface":
                return this.areaSurfaceMeasure;
            case "circle":
                return this.circleMeasure;
            default:
                return null;
        }
    }

    initDrawingControlBar() {
        const doneBtn = document.getElementById("drawingControlDoneBtn");
        const finishPartBtn = document.getElementById("drawingControlFinishPartBtn");
        const undoBtn = document.getElementById("drawingControlUndoBtn");
        const cancelBtn = document.getElementById("drawingControlCancelBtn");

        if (doneBtn) {
            doneBtn.onclick = () => {
                const ctx = this._drawingControlContext;
                if (ctx === "analysis") {
                    if (this.activeDrawer) this.activeDrawer.complete();
                } else if (ctx === "measure") {
                    const instance = this._getActiveMeasureInstance();
                    if (instance && instance.drawer) {
                        instance.drawer.complete();
                    }
                }
            };
        }

        if (undoBtn) {
            undoBtn.onclick = () => {
                const ctx = this._drawingControlContext;
                if (ctx === "analysis") {
                    if (this.activeDrawer) this.activeDrawer.undo();
                } else if (ctx === "measure") {
                    const instance = this._getActiveMeasureInstance();
                    if (instance && instance.drawer) {
                        instance.drawer.undo();
                    }
                }
            };
        }

        if (cancelBtn) {
            cancelBtn.onclick = () => {
                const ctx = this._drawingControlContext;
                if (ctx === "analysis") {
                    if (this.activeDrawer) this.activeDrawer.clear();
                    if (this.cutFillMode) {
                        this.clearCutFill();
                    } else if (this.profileMode) {
                        this.clearProfile();
                    }
                } else if (ctx === "measure") {
                    this.disableAllMeasureModes();
                }
            };
        }
    }

    enableCutFillDrawMode() {
        // Disable other picking/drawing modes to avoid conflict
        if (this.coordPickerMode) {
            this.disableCoordinatePickerMode();
        }
        if (this.activeDrawer) {
            this.activeDrawer.clear();
        }

        this.clearCutFill();
        this.cutFillMode = true;

        // Hide panel and show shared drawing control bar
        const panel = document.getElementById("analysisPanel");
        const normalContent = document.getElementById("analysisNormalContent");
        if (panel) panel.classList.add("hidden");
        if (normalContent) normalContent.classList.add("hidden");
        this.showDrawingControlBar("Click points to draw the area", "analysis");

        this.activeDrawer = new CesiumMapDrawer(this.viewer, {
            mode: "polygon",
            color: CONFIG.BOUNDARY_COLOR_ANALYSIS,
            enableSnap: true,
            snapProvider: this,
            clampGround: false,
            onComplete: (points) => {
                this.cutFillPoints = points;
                this.completeCutFillDraw();
            },
        });
        this.activeDrawer.start();
    }

    disableCutFillDrawMode() {
        this.cutFillMode = false;

        if (this.activeDrawer) {
            this.activeDrawer.stop();
            this.activeDrawer = null;
        }

        // Restore panel state and hide shared drawing control bar
        const panel = document.getElementById("analysisPanel");
        const normalContent = document.getElementById("analysisNormalContent");
        if (panel) panel.classList.remove("hidden");
        if (normalContent) normalContent.classList.remove("hidden");
        this.hideDrawingControlBar("analysis");

        // Restore draw button styling in normal content
        const cutFillDrawBtn = document.getElementById("cutFillDrawBtn");
        const cutFillDrawBtnText = document.getElementById("cutFillDrawBtnText");
        if (cutFillDrawBtnText) {
            cutFillDrawBtnText.textContent = "Draw area";
        }
        if (cutFillDrawBtn) {
            applyBtnStyle(cutFillDrawBtn, "primary");
        }

        this.viewer.scene.requestRender();
    }

    completeCutFillDraw() {
        this.disableCutFillDrawMode();

        // Clear dynamic drawing entities
        if (this.cutFillPolylineEntity) this.viewer.entities.remove(this.cutFillPolylineEntity);
        if (this.cutFillPolygonEntity) this.viewer.entities.remove(this.cutFillPolygonEntity);
        this.cutFillBoundaryPointEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillBoundaryPointEntities = [];
        this.cutFillLabelEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillLabelEntities = [];

        // Render static completed boundary
        this.cutFillPolylineEntity = this.viewer.entities.add({
            name: "Cut Fill Boundary",
            polyline: {
                positions: [...this.cutFillPoints, this.cutFillPoints[0]],
                width: 3,
                material: Cesium.Color.fromCssColorString(CONFIG.BOUNDARY_COLOR_ANALYSIS),
                clampToGround: false,
            },
        });

        this.cutFillPolygonEntity = this.viewer.entities.add({
            name: "Cut Fill Area",
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(this.cutFillPoints),
                material: Cesium.Color.fromCssColorString(CONFIG.BOUNDARY_COLOR_ANALYSIS).withAlpha(
                    0.2,
                ),
                classificationType: undefined,
                perPositionHeight: true,
            },
        });

        // Create static vertex points and segment labels
        this._createStaticDrawingElements(
            this.cutFillPoints,
            true,
            CONFIG.BOUNDARY_COLOR_ANALYSIS,
            this.cutFillBoundaryPointEntities,
            this.cutFillLabelEntities,
            false,
        );

        // Update UI Draw button text
        const cutFillDrawBtnText = document.getElementById("cutFillDrawBtnText");
        const cutFillDrawBtn = document.getElementById("cutFillDrawBtn");
        if (cutFillDrawBtnText) cutFillDrawBtnText.textContent = "Draw area";
        if (cutFillDrawBtn) {
            applyBtnStyle(cutFillDrawBtn, "primary");
        }

        // Enable Calculate button
        const cutFillCalcBtn = document.getElementById("cutFillCalculateBtn");
        if (cutFillCalcBtn) cutFillCalcBtn.removeAttribute("disabled");

        // Reset values to default (0.0)
        const targetElInput = document.getElementById("cutFillTargetElevation");
        if (targetElInput) targetElInput.value = "0.0";

        const boundaryOffsetInput = document.getElementById("cutFillBoundaryOffset");
        if (boundaryOffsetInput) boundaryOffsetInput.value = "0.0";
    }

    _createStaticDrawingElements(
        points,
        isLoop,
        color,
        pointEntitiesArray,
        labelEntitiesArray,
        clampToGround = true,
    ) {
        // Create vertex point markers
        points.forEach((pos) => {
            const pt = this.viewer.entities.add({
                position: pos,
                point: {
                    pixelSize: 6,
                    color: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.fromCssColorString(color),
                    outlineWidth: 1.5,
                    heightReference:
                        clampToGround && this._isTerrainAvailable()
                            ? Cesium.HeightReference.CLAMP_TO_GROUND
                            : Cesium.HeightReference.NONE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            });
            pointEntitiesArray.push(pt);
        });

        // Create labels for all segments
        for (let i = 0; i < points.length - 1; i++) {
            this._createStaticSegmentLabel(
                points[i],
                points[i + 1],
                labelEntitiesArray,
                clampToGround,
            );
        }

        // Closing loop label for polygon
        if (isLoop && points.length >= 3) {
            this._createStaticSegmentLabel(
                points[points.length - 1],
                points[0],
                labelEntitiesArray,
                clampToGround,
            );
        }
    }

    _createStaticSegmentLabel(p1, p2, labelEntitiesArray, clampToGround = true) {
        const distance = Cesium.Cartesian3.distance(p1, p2);
        if (distance < 0.1) return;

        const midPoint = Cesium.Cartesian3.midpoint(p1, p2, new Cesium.Cartesian3());
        const text =
            distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${distance.toFixed(2)} m`;

        const label = this.viewer.entities.add({
            position: midPoint,
            label: {
                text: text,
                font: "bold 12px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: new Cesium.Color(0.04, 0.05, 0.06, 0.85),
                backgroundPadding: new Cesium.Cartesian2(4, 3),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference:
                    clampToGround && this._isTerrainAvailable()
                        ? Cesium.HeightReference.CLAMP_TO_GROUND
                        : Cesium.HeightReference.NONE,
                scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.0, 1.5e6, 0.5),
            },
        });
        labelEntitiesArray.push(label);
    }

    async calculateVolume() {
        if (this.cutFillPoints.length < 3) {
            alert("Draw the area polygon first.");
            return;
        }

        const targetTypeSelect = document.getElementById("cutFillTargetType");
        const targetType = targetTypeSelect ? targetTypeSelect.value : "flat";

        const targetElInput = document.getElementById("cutFillTargetElevation");
        const resolutionSelect = document.getElementById("cutFillResolution");
        const compareTerrainSelect = document.getElementById("cutFillCompareTerrain");

        const targetElevation = targetElInput
            ? parseFloat(targetElInput.value.replace(",", "."))
            : 0.0;
        const resolution = resolutionSelect ? parseFloat(resolutionSelect.value) : 3.0;
        const comparisonUrl = compareTerrainSelect ? compareTerrainSelect.value : "";

        const boundaryOffsetInput = document.getElementById("cutFillBoundaryOffset");
        const boundaryOffset = boundaryOffsetInput
            ? parseFloat(boundaryOffsetInput.value.replace(",", "."))
            : 0.0;

        if (targetType === "flat" && isNaN(targetElevation)) {
            alert("Enter a valid target elevation.");
            return;
        }

        if (targetType === "boundary" && isNaN(boundaryOffset)) {
            alert("Enter a valid elevation offset.");
            return;
        }

        if (targetType === "terrain" && !comparisonUrl) {
            alert("Select a comparison terrain first.");
            return;
        }

        if (targetType === "terrain" && !this.loadedTerrainId) {
            alert("Turn on a terrain layer in the Layers panel first.");
            return;
        }

        const cutFillCalcBtn = document.getElementById("cutFillCalculateBtn");
        const originalHtml = cutFillCalcBtn.innerHTML;

        cutFillCalcBtn.disabled = true;
        cutFillCalcBtn.innerHTML = `${SPINNER_HTML} Calculating...`;

        // Convert polygon vertices to degrees
        const vertices = this.cutFillPoints.map((p) => {
            const carto = Cesium.Cartographic.fromCartesian(p);
            return {
                longitude: Cesium.Math.toDegrees(carto.longitude),
                latitude: Cesium.Math.toDegrees(carto.latitude),
            };
        });

        const gridResult = generateGridPoints(vertices, resolution);

        if (gridResult.error) {
            alert(
                `The area is too large or the resolution too fine (about ${gridResult.estimated.toLocaleString()} points). Draw a smaller area or pick a coarser resolution (e.g. 5 m or 10 m).`,
            );
            cutFillCalcBtn.disabled = false;
            cutFillCalcBtn.innerHTML = originalHtml;
            return;
        }

        const gridPoints = gridResult.points;

        if (gridPoints.length > 50000) {
            alert(
                `The area is too large (${gridPoints.length.toLocaleString()} points inside it). Draw a smaller area or pick a coarser resolution (e.g. 5 m or 10 m).`,
            );
            cutFillCalcBtn.disabled = false;
            cutFillCalcBtn.innerHTML = originalHtml;
            return;
        }

        if (gridPoints.length === 0) {
            alert(
                "No grid points fall inside the polygon. Draw a larger area.",
            );
            cutFillCalcBtn.disabled = false;
            cutFillCalcBtn.innerHTML = originalHtml;
            return;
        }

        try {
            // Sampling terrain heights
            const cartographicsActive = gridPoints.map((p) =>
                Cesium.Cartographic.fromDegrees(p.longitude, p.latitude),
            );

            let sampledActive = [];
            let sampledCompare = [];

            if (targetType === "flat" || targetType === "boundary") {
                sampledActive = await this._sampleTerrainWithFallback(
                    this.viewer.terrainProvider,
                    cartographicsActive,
                );
            } else {
                const comparisonProvider = await this.terrainCache.get(comparisonUrl);

                // Clone coordinates: sampleTerrainMostDetailed mutates the objects in-place (.height property).
                const cartographicsCompare = gridPoints.map((p) =>
                    Cesium.Cartographic.fromDegrees(p.longitude, p.latitude),
                );

                // Fetch both terrain heights concurrently in parallel using separate arrays
                const [activeRes, compareRes] = await Promise.all([
                    this._sampleTerrainWithFallback(
                        this.viewer.terrainProvider,
                        cartographicsActive,
                    ),
                    this._sampleTerrainWithFallback(comparisonProvider, cartographicsCompare),
                ]);
                sampledActive = activeRes;
                sampledCompare = compareRes;
            }

            const totalPoints = gridPoints.length;
            const validActiveCount = sampledActive.filter(
                (pt) => pt && pt.height !== undefined && pt.height !== null,
            ).length;

            let isDataIncomplete = validActiveCount < totalPoints;
            if (targetType === "terrain" && sampledCompare) {
                const validCompareCount = sampledCompare.filter(
                    (pt) => pt && pt.height !== undefined && pt.height !== null,
                ).length;
                if (validCompareCount < totalPoints) {
                    isDataIncomplete = true;
                }
            }

            if (isDataIncomplete) {
                alert(
                    "Warning: some terrain heights could not be loaded. Check your connection.",
                );
            }

            const cellArea = resolution * resolution;

            let totalCut = 0;
            let totalFill = 0;
            let cutCount = 0;
            let fillCount = 0;
            let totalDiff = 0;

            const resultsPoints = [];

            sampledActive.forEach((pt, idx) => {
                if (pt.height !== undefined && pt.height !== null) {
                    let diff = 0;
                    let targetHeight = 0;

                    if (targetType === "flat") {
                        diff = pt.height - targetElevation;
                        targetHeight = targetElevation;
                    } else if (targetType === "boundary") {
                        const lonDeg = Cesium.Math.toDegrees(pt.longitude);
                        const latDeg = Cesium.Math.toDegrees(pt.latitude);
                        targetHeight =
                            this._interpolatePolygonHeight(lonDeg, latDeg, this.cutFillPoints) +
                            boundaryOffset;
                        diff = pt.height - targetHeight;
                    } else {
                        const compPt = sampledCompare[idx];
                        if (compPt && compPt.height !== undefined && compPt.height !== null) {
                            diff = pt.height - compPt.height; // Active terrain (A) minus historical terrain (B)
                            targetHeight = compPt.height;
                        } else {
                            return; // skip if comparison terrain lacks data
                        }
                    }

                    totalDiff += diff;

                    if (diff > 0) {
                        totalCut += diff * cellArea;
                        cutCount++;
                    } else if (diff < 0) {
                        totalFill += Math.abs(diff) * cellArea;
                        fillCount++;
                    }

                    resultsPoints.push({
                        longitude: Cesium.Math.toDegrees(pt.longitude),
                        latitude: Cesium.Math.toDegrees(pt.latitude),
                        height: pt.height,
                        targetHeight: targetHeight,
                        diff: diff,
                    });
                }
            });

            const totalCells = resultsPoints.length;
            const gridArea = totalCells * cellArea;

            let planarArea = 0;
            let surfaceArea = 0;

            try {
                if (!this.areaMeasure) {
                    this.areaMeasure = new AreaMeasure(this.viewer, this._createMeasureOptions());
                }
                planarArea = this.areaMeasure.getArea(this.cutFillPoints);
            } catch (e) {
                console.warn("Failed to calculate planar area via AreaMeasure:", e);
                planarArea = gridArea;
            }

            try {
                if (!this.areaSurfaceMeasure) {
                    this.areaSurfaceMeasure = new AreaSurfaceMeasure(
                        this.viewer,
                        this._createMeasureOptions(),
                    );
                }
                surfaceArea = this.areaSurfaceMeasure.getArea(this.cutFillPoints);
            } catch (e) {
                console.warn("Failed to calculate surface area via AreaSurfaceMeasure:", e);
                surfaceArea = planarArea;
            }

            const netVolume = totalCut - totalFill;
            const avgDepth = totalCells > 0 ? totalDiff / totalCells : 0;

            this.cutFillResultsData = {
                area: planarArea,
                surfaceArea: surfaceArea,
                cut: totalCut,
                fill: totalFill,
                net: netVolume,
                avgDepth: avgDepth,
                points: resultsPoints,
                resolution: resolution,
            };

            // Populate UI Results with clean Unicode symbols
            document.getElementById("cutFillResultPlanarArea").textContent =
                `${formatNumber(planarArea || 0)} m²`;
            document.getElementById("cutFillResultSurfaceArea").textContent =
                `${formatNumber(surfaceArea || 0)} m²`;
            document.getElementById("cutFillResultCut").textContent =
                `${formatNumber(totalCut)} Bcm`;
            document.getElementById("cutFillResultFill").textContent =
                `${formatNumber(totalFill)} Bcm`;

            const netEl = document.getElementById("cutFillResultNet");
            if (netVolume > 0) {
                netEl.textContent = `+${formatNumber(netVolume)} Bcm`;
                netEl.className = "font-semibold text-error";
            } else if (netVolume < 0) {
                netEl.textContent = `${formatNumber(netVolume)} Bcm`;
                netEl.className = "font-semibold text-primary";
            } else {
                netEl.textContent = `0 Bcm`;
                netEl.className = "font-semibold text-foreground/85";
            }

            document.getElementById("cutFillResultAvgDepth").textContent =
                `${avgDepth.toFixed(2)} m`;

            // Reveal Results Panel
            document.getElementById("cutFillResultsSection").classList.remove("hidden");

            // Render Visualization Grid
            this.renderCutFillVisualization();
        } catch (err) {
            console.error("Terrain sampling failed:", err);
            alert("Could not sample terrain heights. Make sure a terrain layer is turned on.");
        } finally {
            cutFillCalcBtn.disabled = false;
            cutFillCalcBtn.innerHTML = originalHtml;
        }
    }

    renderCutFillVisualization() {
        // Clear previous visualizations
        if (this.cutFillPrimitive) {
            this.viewer.scene.primitives.remove(this.cutFillPrimitive);
            this.cutFillPrimitive = null;
        }
        if (this.cutFillPointsCollection) {
            this.viewer.scene.primitives.remove(this.cutFillPointsCollection);
            this.cutFillPointsCollection = null;
        }
        if (this.cutFillHeatmapEntity) {
            this.viewer.entities.remove(this.cutFillHeatmapEntity);
            this.cutFillHeatmapEntity = null;
        }

        // Fallback cleanup of legacy entities
        this.cutFillHeatmapEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillPointEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillHeatmapEntities = [];
        this.cutFillPointEntities = [];

        if (!this.cutFillResultsData) return;

        const showHeatmap = document.getElementById("cutFillToggleHeatmap").checked;
        const showPoints = document.getElementById("cutFillTogglePoints").checked;

        const points = this.cutFillResultsData.points;
        const resolution = this.cutFillResultsData.resolution;

        if (points.length === 0) return;

        // 1. Compute the bounding box and grid dimensions from the data points
        let dataMinLon = Infinity,
            dataMaxLon = -Infinity;
        let dataMinLat = Infinity,
            dataMaxLat = -Infinity;
        for (const pt of points) {
            if (pt.longitude < dataMinLon) dataMinLon = pt.longitude;
            if (pt.longitude > dataMaxLon) dataMaxLon = pt.longitude;
            if (pt.latitude < dataMinLat) dataMinLat = pt.latitude;
            if (pt.latitude > dataMaxLat) dataMaxLat = pt.latitude;
        }

        const midLat = (dataMinLat + dataMaxLat) / 2;
        const latStep = resolution / 111320;
        const lonStep = resolution / (111320 * Math.cos(Cesium.Math.toRadians(midLat)));

        // Grid dimensions in cells
        const gridCols = Math.round((dataMaxLon - dataMinLon) / lonStep) + 1;
        const gridRows = Math.round((dataMaxLat - dataMinLat) / latStep) + 1;

        // Expand bounding box by half a cell so each point's cell is fully covered
        const bboxWest = dataMinLon - lonStep / 2;
        const bboxEast = dataMaxLon + lonStep / 2;
        const bboxSouth = dataMinLat - latStep / 2;
        const bboxNorth = dataMaxLat + latStep / 2;

        // 2. Paint the heatmap onto an offscreen Canvas (one pixel per grid cell)
        const canvas = document.createElement("canvas");
        canvas.width = gridCols;
        canvas.height = gridRows;
        const ctx = canvas.getContext("2d");

        // Start fully transparent
        ctx.clearRect(0, 0, gridCols, gridRows);

        // Build a lookup grid for click-based property inspection
        this._cutFillGridLookup = {
            minLon: bboxWest,
            maxLon: bboxEast,
            minLat: bboxSouth,
            maxLat: bboxNorth,
            cols: gridCols,
            rows: gridRows,
            latStep,
            lonStep,
            data: new Array(gridRows * gridCols).fill(null),
        };

        const maxDiff = 5.0;
        for (const pt of points) {
            const col = Math.round((pt.longitude - dataMinLon) / lonStep);
            const row = Math.round((dataMaxLat - pt.latitude) / latStep); // canvas Y is top-down

            if (col < 0 || col >= gridCols || row < 0 || row >= gridRows) continue;

            let r, g, b, a;
            if (pt.diff > 0.005) {
                const intensity = Math.min(pt.diff / maxDiff, 1.0) * 0.5 + 0.2;
                r = 255;
                g = 0;
                b = 0;
                a = intensity;
            } else if (pt.diff < -0.005) {
                const intensity = Math.min(Math.abs(pt.diff) / maxDiff, 1.0) * 0.5 + 0.2;
                r = 0;
                g = 0;
                b = 255;
                a = intensity;
            } else {
                r = 0;
                g = 255;
                b = 0;
                a = 0.15;
            }

            ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
            ctx.fillRect(col, row, 1, 1);

            // Store data for property lookup on click
            this._cutFillGridLookup.data[row * gridCols + col] = pt;
        }

        // 3. Create a single Rectangle Entity with the canvas as texture (extremely lightweight)
        this.cutFillHeatmapEntity = this.viewer.entities.add({
            name: "Cut/Fill Heatmap",
            rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(bboxWest, bboxSouth, bboxEast, bboxNorth),
                material: new Cesium.ImageMaterialProperty({
                    image: canvas,
                    transparent: true,
                }),
                classificationType: this._drawClassificationType(),
            },
            show: showHeatmap,
        });

        // 4. Create PointPrimitiveCollection for grid nodes (always populated, visibility is driven by showPoints)
        this.cutFillPointsCollection = this.viewer.scene.primitives.add(
            new Cesium.PointPrimitiveCollection({
                blendOption: Cesium.BlendOption.TRANSLUCENT,
                show: showPoints,
            }),
        );

        for (const pt of points) {
            this.cutFillPointsCollection.add({
                position: Cesium.Cartesian3.fromDegrees(pt.longitude, pt.latitude, pt.height),
                pixelSize: 6,
                color: pt.diff > 0 ? Cesium.Color.RED : Cesium.Color.BLUE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                id: {
                    Type: "Grid Node",
                    Location: `${pt.latitude.toFixed(6)}°, ${pt.longitude.toFixed(6)}°`,
                    Elevation: `${pt.height.toFixed(2)} m`,
                    "Target Elevation": `${pt.targetHeight.toFixed(2)} m`,
                    "Difference (Cut/Fill)": `${pt.diff > 0.005 ? "+" : ""}${pt.diff.toFixed(2)} m`,
                },
            });
        }

        this.viewer.scene.requestRender();
    }

    clearCutFill() {
        this.disableCutFillDrawMode();

        // Clear drawn polygon entities
        if (this.cutFillPolylineEntity) {
            this.viewer.entities.remove(this.cutFillPolylineEntity);
            this.cutFillPolylineEntity = null;
        }
        if (this.cutFillPolygonEntity) {
            this.viewer.entities.remove(this.cutFillPolygonEntity);
            this.cutFillPolygonEntity = null;
        }

        // Clear static boundary vertex points
        this.cutFillBoundaryPointEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillBoundaryPointEntities = [];

        // Clear static segment labels
        this.cutFillLabelEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillLabelEntities = [];

        // Clear canvas-textured heatmap entity
        if (this.cutFillHeatmapEntity) {
            this.viewer.entities.remove(this.cutFillHeatmapEntity);
            this.cutFillHeatmapEntity = null;
        }
        this._cutFillGridLookup = null;

        // Clear low-level primitives
        if (this.cutFillPrimitive) {
            this.viewer.scene.primitives.remove(this.cutFillPrimitive);
            this.cutFillPrimitive = null;
        }
        if (this.cutFillPointsCollection) {
            this.viewer.scene.primitives.remove(this.cutFillPointsCollection);
            this.cutFillPointsCollection = null;
        }

        // Clear fallback grid visualizations
        this.cutFillHeatmapEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillPointEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.cutFillHeatmapEntities = [];
        this.cutFillPointEntities = [];

        this.cutFillPoints = [];
        this.cutFillResultsData = null;

        // Reset UI elements
        const cutFillDrawBtnText = document.getElementById("cutFillDrawBtnText");
        const cutFillDrawBtn = document.getElementById("cutFillDrawBtn");
        if (cutFillDrawBtnText) cutFillDrawBtnText.textContent = "Draw area";
        if (cutFillDrawBtn) {
            applyBtnStyle(cutFillDrawBtn, "primary");
        }

        const cutFillCalcBtn = document.getElementById("cutFillCalculateBtn");
        if (cutFillCalcBtn) cutFillCalcBtn.setAttribute("disabled", "true");

        const resultsSection = document.getElementById("cutFillResultsSection");
        if (resultsSection) resultsSection.classList.add("hidden");

        this.viewer.scene.requestRender();
    }

    updateCutFillVisuals() {
        if (!this.cutFillPoints || this.cutFillPoints.length === 0) return;

        const targetTypeSelect = document.getElementById("cutFillTargetType");
        const targetType = targetTypeSelect ? targetTypeSelect.value : "flat";

        let offset = 0;
        if (targetType === "boundary") {
            const boundaryOffsetInput = document.getElementById("cutFillBoundaryOffset");
            if (boundaryOffsetInput) {
                const parsed = parseFloat(boundaryOffsetInput.value.replace(",", "."));
                if (!isNaN(parsed)) {
                    offset = parsed;
                }
            }
        }

        // Generate shifted points
        const shiftedPoints = this.cutFillPoints.map((p) => {
            const carto = Cesium.Cartographic.fromCartesian(p);
            return Cesium.Cartesian3.fromRadians(
                carto.longitude,
                carto.latitude,
                (carto.height || 0) + offset,
            );
        });

        // Update Polyline
        if (this.cutFillPolylineEntity && this.cutFillPolylineEntity.polyline) {
            this.cutFillPolylineEntity.polyline.positions = [...shiftedPoints, shiftedPoints[0]];
        }

        // Update Polygon
        if (this.cutFillPolygonEntity && this.cutFillPolygonEntity.polygon) {
            this.cutFillPolygonEntity.polygon.hierarchy = new Cesium.PolygonHierarchy(
                shiftedPoints,
            );
        }

        // Update Boundary Points
        if (
            this.cutFillBoundaryPointEntities &&
            this.cutFillBoundaryPointEntities.length === shiftedPoints.length
        ) {
            this.cutFillBoundaryPointEntities.forEach((ent, idx) => {
                ent.position = shiftedPoints[idx];
            });
        }

        // Update Labels (midpoint between consecutive points)
        if (this.cutFillLabelEntities && this.cutFillLabelEntities.length > 0) {
            let labelIdx = 0;
            for (let i = 0; i < shiftedPoints.length - 1; i++) {
                if (labelIdx < this.cutFillLabelEntities.length) {
                    const mid = Cesium.Cartesian3.midpoint(
                        shiftedPoints[i],
                        shiftedPoints[i + 1],
                        new Cesium.Cartesian3(),
                    );
                    this.cutFillLabelEntities[labelIdx].position = mid;
                    labelIdx++;
                }
            }
            if (shiftedPoints.length >= 3 && labelIdx < this.cutFillLabelEntities.length) {
                const mid = Cesium.Cartesian3.midpoint(
                    shiftedPoints[shiftedPoints.length - 1],
                    shiftedPoints[0],
                    new Cesium.Cartesian3(),
                );
                this.cutFillLabelEntities[labelIdx].position = mid;
            }
        }

        this.viewer.scene.requestRender();
    }

    disableCutFillMode() {
        const wasDrawing = this.cutFillMode;
        this.disableCutFillDrawMode();
        if (wasDrawing) {
            this.clearCutFill();
        }

        const panel = document.getElementById("analysisPanel");
        if (panel) {
            panel.classList.remove("active");
        }

        if (this.activeMeasureMode === "cut_fill") {
            this.activeMeasureMode = null;
            this._updateMeasureUI();
        }
    }

    // ==========================================
    // TERRAIN PROFILE SECTION MODULE
    // ==========================================

    initProfilePanelUI() {
        const profileDrawBtn = document.getElementById("profileDrawBtn");
        const profileDrawBtnText = document.getElementById("profileDrawBtnText");
        const profileClearBtn = document.getElementById("profileClearBtn");
        const profileGenerateBtn = document.getElementById("profileGenerateBtn");
        const settingElevationBandEl = document.getElementById("settingElevationBand");
        const closeBtn = document.getElementById("closeAnalysisBtn");

        const cutFillTabBtn = document.getElementById("cut-fill-tab-btn");
        const profileTabBtn = document.getElementById("profile-section-tab-btn");

        const profileMode = document.getElementById("profileMode");
        const profileTerrainGroup = document.getElementById("profileTerrainGroup");
        const profileCompareTerrain = document.getElementById("profileCompareTerrain");
        const profileCompareTerrainSpinner = document.getElementById(
            "profileCompareTerrainSpinner",
        );

        if (profileMode && profileTerrainGroup && profileCompareTerrain) {
            profileMode.onchange = (e) => {
                const type = e.target.value;
                if (type === "single") {
                    profileTerrainGroup.classList.add("hidden");
                } else if (type === "double") {
                    profileTerrainGroup.classList.remove("hidden");
                    this.fetchComparisonTerrains(
                        "profileCompareTerrain",
                        "profileCompareTerrainSpinner",
                    );
                }
            };
        }

        if (profileDrawBtn) {
            profileDrawBtn.onclick = () => {
                if (this.activeDrawer && this.profileMode) {
                    this.disableProfileDrawMode();
                } else {
                    this.enableProfileDrawMode();
                    if (profileDrawBtnText) profileDrawBtnText.textContent = "Cancel drawing";
                    applyBtnStyle(profileDrawBtn, "danger");
                }
            };
        }

        if (profileClearBtn) {
            profileClearBtn.onclick = () => this.clearProfile();
        }

        if (profileGenerateBtn) {
            profileGenerateBtn.onclick = () => this.generateProfile();
        }

        // Shared close button logic
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.disableCutFillMode();
                this.disableProfileMode();
            };
        }

        // Tab switches deactivation
        if (cutFillTabBtn) {
            cutFillTabBtn.addEventListener("click", () => {
                this.disableProfileDrawMode();
                this.clearProfile();
                this.activeMeasureMode = "cut_fill";
                this._updateMeasureUI();
            });
        }

        if (profileTabBtn) {
            profileTabBtn.addEventListener("click", () => {
                this.disableCutFillDrawMode();
                this.clearCutFill();
                this.activeMeasureMode = "profile";
                this._updateMeasureUI();
            });
        }

        if (settingElevationBandEl) {
            settingElevationBandEl.checked = false;
            settingElevationBandEl.addEventListener("change", (e) => {
                const on = e.target.checked;
                const viewer = this.viewer;

                if (on) {
                    let minHeight = -10.0;
                    let maxHeight = 100.0;

                    if (viewer.terrainProvider) {
                        if (typeof viewer.terrainProvider.minHeight !== "undefined")
                            minHeight = viewer.terrainProvider.minHeight;
                        if (typeof viewer.terrainProvider.maxHeight !== "undefined")
                            maxHeight = viewer.terrainProvider.maxHeight;
                    }

                    viewer.scene.globe.material = Cesium.createElevationBandMaterial({
                        scene: viewer.scene,
                        layers: [
                            {
                                entries: [
                                    {
                                        height: minHeight,
                                        color: new Cesium.Color(0.2, 0.4, 0.8, 0.98),
                                    }, // blue
                                    {
                                        height: maxHeight,
                                        color: new Cesium.Color(0.95, 0.95, 0.95, 0.98),
                                    }, // White
                                ],
                                extendDownwards: true,
                                extendUpwards: true,
                            },
                        ],
                    });

                    for (let i = 0; i < viewer.imageryLayers.length; i++) {
                        viewer.imageryLayers.get(i).show = false;
                    }
                } else {
                    viewer.scene.globe.material = undefined;

                    for (let i = 0; i < viewer.imageryLayers.length; i++) {
                        viewer.imageryLayers.get(i).show = true;
                    }
                }
                viewer.scene.requestRender();
            });
        }

        this.initDrawingControlBar();
    }

    enableProfileDrawMode() {
        if (this.coordPickerMode) {
            this.disableCoordinatePickerMode();
        }
        if (this.cutFillMode) {
            this.disableCutFillDrawMode();
        }
        if (this.activeDrawer) {
            this.activeDrawer.clear();
        }

        this.clearProfile();
        this.profileMode = true;

        const panel = document.getElementById("analysisPanel");
        const normalContent = document.getElementById("analysisNormalContent");
        if (panel) panel.classList.add("hidden");
        if (normalContent) normalContent.classList.add("hidden");
        this.showDrawingControlBar("Click points to draw the profile line", "analysis");

        this.activeDrawer = new CesiumMapDrawer(this.viewer, {
            mode: "line",
            color: CONFIG.BOUNDARY_COLOR_ANALYSIS,
            enableSnap: false,
            snapProvider: this,
            clampGround: true,
            onComplete: (points) => {
                this.profilePoints = points;
                this.completeProfileDraw();
            },
        });
        this.activeDrawer.start();
    }

    disableProfileDrawMode() {
        this.profileMode = false;

        if (this.activeDrawer) {
            this.activeDrawer.stop();
            this.activeDrawer = null;
        }

        const panel = document.getElementById("analysisPanel");
        const normalContent = document.getElementById("analysisNormalContent");
        if (panel) panel.classList.remove("hidden");
        if (normalContent) normalContent.classList.remove("hidden");
        this.hideDrawingControlBar("analysis");

        const profileDrawBtn = document.getElementById("profileDrawBtn");
        const profileDrawBtnText = document.getElementById("profileDrawBtnText");
        if (profileDrawBtnText) {
            profileDrawBtnText.textContent = "Draw profile line";
        }
        if (profileDrawBtn) {
            applyBtnStyle(profileDrawBtn, "primary");
        }

        this.viewer.scene.requestRender();
    }

    completeProfileDraw() {
        this.disableProfileDrawMode();

        if (this.profilePolylineEntity) this.viewer.entities.remove(this.profilePolylineEntity);
        this.profilePointEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.profilePointEntities = [];
        this.profileLabelEntities.forEach((ent) => this.viewer.entities.remove(ent));
        this.profileLabelEntities = [];

        this.profilePolylineEntity = this.viewer.entities.add({
            name: "Profile Boundary Line",
            polyline: {
                positions: this.profilePoints,
                width: 4,
                material: Cesium.Color.fromCssColorString(CONFIG.BOUNDARY_COLOR_ANALYSIS),
                clampToGround: this._drawClampToGround(),
            },
        });

        // Create static vertex points and segment labels
        this._createStaticDrawingElements(
            this.profilePoints,
            false,
            CONFIG.BOUNDARY_COLOR_ANALYSIS,
            this.profilePointEntities,
            this.profileLabelEntities,
        );

        const profileDrawBtnText = document.getElementById("profileDrawBtnText");
        const profileDrawBtn = document.getElementById("profileDrawBtn");
        if (profileDrawBtnText) profileDrawBtnText.textContent = "Draw profile line";
        if (profileDrawBtn) {
            applyBtnStyle(profileDrawBtn, "primary");
        }

        const profileGenerateBtn = document.getElementById("profileGenerateBtn");
        if (profileGenerateBtn) profileGenerateBtn.removeAttribute("disabled");
    }

    async _sampleTerrainWithFallback(provider, cartographics) {
        try {
            return await Cesium.sampleTerrainMostDetailed(provider, cartographics);
        } catch (err) {
            console.warn(
                "Detailed terrain sampling failed, falling back to the scene:",
                err,
            );
            return cartographics.map((carto) => {
                const result = Cesium.Cartographic.clone(carto);
                const sceneHeight = this.viewer.scene.globe.getHeight(carto);
                result.height =
                    sceneHeight !== undefined && sceneHeight !== null ? sceneHeight : undefined;
                return result;
            });
        }
    }

    async generateProfile() {
        if (this.profilePoints.length < 2) return;

        const intervalSelect = document.getElementById("profileSampleInterval");
        const interval = parseFloat(intervalSelect?.value || "3");

        const profileModeSelect = document.getElementById("profileMode");
        const profileMode = profileModeSelect ? profileModeSelect.value : "single";

        let compareTerrainUrl = "";
        if (profileMode === "double") {
            const compareTerrainSelect = document.getElementById("profileCompareTerrain");
            compareTerrainUrl = compareTerrainSelect ? compareTerrainSelect.value : "";
            if (!compareTerrainUrl) {
                alert("Select a comparison terrain first.");
                return;
            }
        }

        let totalDrawnDistance = 0;
        for (let i = 0; i < this.profilePoints.length - 1; i++) {
            totalDrawnDistance += Cesium.Cartesian3.distance(
                this.profilePoints[i],
                this.profilePoints[i + 1],
            );
        }

        if (
            !this.viewer.terrainProvider ||
            this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider
        ) {
            alert("Turn on a terrain layer first.");
            return;
        }

        if (totalDrawnDistance < interval) {
            alert(
                `The profile line (${totalDrawnDistance.toFixed(1)} m) is shorter than the sampling interval (${interval} m). Draw a longer line or use a smaller interval.`,
            );
            return;
        }

        const generateBtn = document.getElementById("profileGenerateBtn");
        const originalHtml = generateBtn ? generateBtn.innerHTML : "";

        if (generateBtn) {
            generateBtn.setAttribute("disabled", "true");
            generateBtn.innerHTML = `${SPINNER_HTML} Generating...`;
        }

        try {
            const interpolatedPoints = this._interpolatePolylinePoints(interval);
            if (interpolatedPoints.length === 0) {
                throw new Error("No points could be interpolated.");
            }

            const cartographicsActive = interpolatedPoints.map((pt) =>
                Cesium.Cartographic.fromCartesian(pt.cartesian),
            );

            let sampledActive = [];
            let sampledCompare = [];

            if (profileMode === "single") {
                sampledActive = await this._sampleTerrainWithFallback(
                    this.viewer.terrainProvider,
                    cartographicsActive,
                );
            } else {
                let comparisonProvider;
                try {
                    comparisonProvider = await this.terrainCache.get(compareTerrainUrl);
                } catch (loadErr) {
                    console.error("Failed to load comparison terrain provider:", loadErr);
                    alert(
                        "Could not load the comparison terrain. Check your connection and try again.",
                    );
                    return;
                }

                // Clone coordinates since sampleTerrainMostDetailed mutates height in-place
                const cartographicsCompare = interpolatedPoints.map((pt) =>
                    Cesium.Cartographic.fromCartesian(pt.cartesian),
                );

                const [activeRes, compareRes] = await Promise.all([
                    this._sampleTerrainWithFallback(
                        this.viewer.terrainProvider,
                        cartographicsActive,
                    ),
                    this._sampleTerrainWithFallback(comparisonProvider, cartographicsCompare),
                ]);

                sampledActive = activeRes;
                sampledCompare = compareRes;
            }

            // Check if there are any valid heights
            const validActivePoints = sampledActive.filter(
                (pt) => pt && pt.height !== undefined && pt.height !== null,
            );

            if (validActivePoints.length === 0) {
                alert(
                    "No elevation data for the profile. Let the area finish loading or check your connection.",
                );
                return;
            }

            if (profileMode === "double") {
                const validComparePoints = sampledCompare.filter(
                    (pt) => pt && pt.height !== undefined && pt.height !== null,
                );
                if (validComparePoints.length === 0) {
                    alert(
                        "No elevation data for the comparison terrain. Let the area finish loading or check your connection.",
                    );
                    return;
                }
            }

            let lastValidActiveHeight = 0;
            const firstValidActive = sampledActive.find(
                (pt) => pt && pt.height !== undefined && pt.height !== null,
            );
            if (firstValidActive) {
                lastValidActiveHeight = firstValidActive.height;
            }

            const samples = sampledActive.map((pt, idx) => {
                const height =
                    pt && pt.height !== undefined && pt.height !== null
                        ? pt.height
                        : lastValidActiveHeight;
                lastValidActiveHeight = height;
                const updatedCartesian = Cesium.Cartesian3.fromRadians(
                    pt.longitude,
                    pt.latitude,
                    height,
                );
                return {
                    distance: interpolatedPoints[idx].distance,
                    height: height,
                    cartesian: updatedCartesian,
                };
            });

            let compareSamples = null;
            if (profileMode === "double" && sampledCompare.length > 0) {
                let lastValidCompareHeight = 0;
                const firstValidCompare = sampledCompare.find(
                    (pt) => pt && pt.height !== undefined && pt.height !== null,
                );
                if (firstValidCompare) {
                    lastValidCompareHeight = firstValidCompare.height;
                }

                compareSamples = sampledCompare.map((pt, idx) => {
                    const height =
                        pt && pt.height !== undefined && pt.height !== null
                            ? pt.height
                            : lastValidCompareHeight;
                    lastValidCompareHeight = height;
                    const updatedCartesian = Cesium.Cartesian3.fromRadians(
                        pt.longitude,
                        pt.latitude,
                        height,
                    );
                    return {
                        distance: interpolatedPoints[idx].distance,
                        height: height,
                        cartesian: updatedCartesian,
                    };
                });
            }

            const totalDistance = samples[samples.length - 1].distance;
            const heights = samples.map((s) => s.height);
            const minHeight = Math.min(...heights);
            const maxHeight = Math.max(...heights);

            let elevGain = 0;
            let elevLoss = 0;
            let totalVerticalChange = 0;

            for (let i = 1; i < samples.length; i++) {
                const dh = samples[i].height - samples[i - 1].height;
                if (dh > 0) {
                    elevGain += dh;
                } else {
                    elevLoss += Math.abs(dh);
                }
                totalVerticalChange += Math.abs(dh);
            }

            const avgSlope = totalDistance > 0 ? (totalVerticalChange / totalDistance) * 100 : 0;

            let compareStats = null;
            if (profileMode === "double" && compareSamples) {
                const compareHeights = compareSamples.map((s) => s.height);
                const compareMinHeight = Math.min(...compareHeights);
                const compareMaxHeight = Math.max(...compareHeights);

                let compareElevGain = 0;
                let compareElevLoss = 0;
                let compareTotalVerticalChange = 0;

                for (let i = 1; i < compareSamples.length; i++) {
                    const dh = compareSamples[i].height - compareSamples[i - 1].height;
                    if (dh > 0) {
                        compareElevGain += dh;
                    } else {
                        compareElevLoss += Math.abs(dh);
                    }
                    compareTotalVerticalChange += Math.abs(dh);
                }

                const compareAvgSlope =
                    totalDistance > 0 ? (compareTotalVerticalChange / totalDistance) * 100 : 0;

                compareStats = {
                    minHeight: compareMinHeight,
                    maxHeight: compareMaxHeight,
                    elevGain: compareElevGain,
                    elevLoss: compareElevLoss,
                    avgSlope: compareAvgSlope,
                };
            }

            const totalLengthEl = document.getElementById("profileTotalLength");
            const avgSlopeEl = document.getElementById("profileAvgSlope");
            const minElevationEl = document.getElementById("profileMinElevation");
            const maxElevationEl = document.getElementById("profileMaxElevation");
            const elevGainEl = document.getElementById("profileElevationGain");
            const elevLossEl = document.getElementById("profileElevationLoss");

            if (totalLengthEl) {
                totalLengthEl.textContent =
                    totalDistance >= 1000
                        ? `${formatNumber(totalDistance / 1000)} km`
                        : `${formatNumber(totalDistance)} m`;
            }
            if (avgSlopeEl) avgSlopeEl.textContent = `${formatNumber(avgSlope)}%`;
            if (minElevationEl) minElevationEl.textContent = `${formatNumber(minHeight)} m`;
            if (maxElevationEl) maxElevationEl.textContent = `${formatNumber(maxHeight)} m`;
            if (elevGainEl) elevGainEl.textContent = `+${formatNumber(elevGain)} m`;
            if (elevLossEl) elevLossEl.textContent = `-${formatNumber(elevLoss)} m`;

            const compareStatsSection = document.getElementById("profileCompareStatsSection");
            const deltaStatsSection = document.getElementById("profileDeltaStatsSection");

            if (profileMode === "double" && compareStats && compareSamples) {
                // Populate compare stats
                const compareAvgSlopeEl = document.getElementById("profileCompareAvgSlope");
                const compareMinElevationEl = document.getElementById("profileCompareMinElevation");
                const compareMaxElevationEl = document.getElementById("profileCompareMaxElevation");
                const compareElevationGainEl = document.getElementById(
                    "profileCompareElevationGain",
                );
                const compareElevationLossEl = document.getElementById(
                    "profileCompareElevationLoss",
                );

                if (compareAvgSlopeEl)
                    compareAvgSlopeEl.textContent = `${formatNumber(compareStats.avgSlope)}%`;
                if (compareMinElevationEl)
                    compareMinElevationEl.textContent = `${formatNumber(compareStats.minHeight)} m`;
                if (compareMaxElevationEl)
                    compareMaxElevationEl.textContent = `${formatNumber(compareStats.maxHeight)} m`;
                if (compareElevationGainEl)
                    compareElevationGainEl.textContent = `+${formatNumber(compareStats.elevGain)} m`;
                if (compareElevationLossEl)
                    compareElevationLossEl.textContent = `-${formatNumber(compareStats.elevLoss)} m`;

                // Calculate delta stats (Active - Compare)
                const deltaHeights = samples.map((s, idx) => s.height - compareSamples[idx].height);
                const deltaAvg = deltaHeights.reduce((sum, h) => sum + h, 0) / deltaHeights.length;
                const deltaMin = minHeight - compareStats.minHeight;
                const deltaMax = maxHeight - compareStats.maxHeight;

                const deltaAvgEl = document.getElementById("profileDeltaAvg");
                const deltaMinEl = document.getElementById("profileDeltaMin");
                const deltaMaxEl = document.getElementById("profileDeltaMax");

                const formatDelta = (val) => {
                    const prefix = val > 0 ? "+" : "";
                    return `${prefix}${formatNumber(val)} m`;
                };

                if (deltaAvgEl) deltaAvgEl.textContent = formatDelta(deltaAvg);
                if (deltaMinEl) deltaMinEl.textContent = formatDelta(deltaMin);
                if (deltaMaxEl) deltaMaxEl.textContent = formatDelta(deltaMax);

                if (compareStatsSection) compareStatsSection.classList.remove("hidden");
                if (deltaStatsSection) deltaStatsSection.classList.remove("hidden");
            } else {
                if (compareStatsSection) compareStatsSection.classList.add("hidden");
                if (deltaStatsSection) deltaStatsSection.classList.add("hidden");
            }

            const resultsSection = document.getElementById("profileResultsSection");
            if (resultsSection) resultsSection.classList.remove("hidden");

            this.renderProfileChart(samples, compareSamples);
        } catch (err) {
            console.error("Error generating profile:", err);
            alert("Profile failed: " + err.message);
        } finally {
            if (generateBtn) {
                generateBtn.removeAttribute("disabled");
                generateBtn.innerHTML = originalHtml;
            }
        }
    }

    _interpolatePolylinePoints(interval) {
        const points = this.profilePoints;
        if (points.length < 2) return [];

        const interpolated = [];
        let totalDistance = 0;

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const segmentDistance = Cesium.Cartesian3.distance(p1, p2);

            const steps = Math.max(1, Math.ceil(segmentDistance / interval));

            for (let j = 0; j < steps; j++) {
                const t = j / steps;
                const pt = Cesium.Cartesian3.lerp(p1, p2, t, new Cesium.Cartesian3());
                const stepDistance = segmentDistance * t;

                interpolated.push({
                    cartesian: pt,
                    distance: totalDistance + stepDistance,
                });
            }

            totalDistance += segmentDistance;
        }

        const lastPt = points[points.length - 1];
        interpolated.push({
            cartesian: lastPt,
            distance: totalDistance,
        });

        return interpolated;
    }

    renderProfileChart(samples, compareSamples = null) {
        const canvas = document.getElementById("profileChart");
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        const padding = { top: 15, right: 15, bottom: 25, left: 45 };
        const chartWidth = rect.width - padding.left - padding.right;
        const chartHeight = rect.height - padding.top - padding.bottom;

        const maxX = samples[samples.length - 1].distance;
        const elevations = [...samples.map((s) => s.height)];
        if (compareSamples) {
            elevations.push(...compareSamples.map((s) => s.height));
        }
        const actualMinY = Math.min(...elevations);
        const actualMaxY = Math.max(...elevations);

        const yRange = actualMaxY - actualMinY;
        const yPadding = yRange * 0.1 || 10;
        const minY = actualMinY - yPadding;
        const maxY = actualMaxY + yPadding;

        this._drawChartWithCrosshair(
            canvas,
            ctx,
            rect.width,
            rect.height,
            padding,
            chartWidth,
            chartHeight,
            samples,
            compareSamples,
            minY,
            maxY,
            maxX,
            null,
        );

        canvas.onmousemove = (event) => {
            const mRect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - mRect.left;

            if (mouseX >= padding.left && mouseX <= padding.left + chartWidth) {
                const pct = (mouseX - padding.left) / chartWidth;
                const targetDistance = pct * maxX;

                let closestIdx = 0;
                let minDiff = Infinity;
                for (let i = 0; i < samples.length; i++) {
                    const diff = Math.abs(samples[i].distance - targetDistance);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                    }
                }

                const activeSample = samples[closestIdx];
                this._drawChartWithCrosshair(
                    canvas,
                    ctx,
                    rect.width,
                    rect.height,
                    padding,
                    chartWidth,
                    chartHeight,
                    samples,
                    compareSamples,
                    minY,
                    maxY,
                    maxX,
                    closestIdx,
                );
                this._updateProfileMarker(
                    activeSample.cartesian,
                    activeSample.height,
                    compareSamples ? compareSamples[closestIdx].height : null,
                );
            } else {
                this._drawChartWithCrosshair(
                    canvas,
                    ctx,
                    rect.width,
                    rect.height,
                    padding,
                    chartWidth,
                    chartHeight,
                    samples,
                    compareSamples,
                    minY,
                    maxY,
                    maxX,
                    null,
                );
                this._removeProfileMarker();
            }
        };

        canvas.onmouseleave = () => {
            this._drawChartWithCrosshair(
                canvas,
                ctx,
                rect.width,
                rect.height,
                padding,
                chartWidth,
                chartHeight,
                samples,
                compareSamples,
                minY,
                maxY,
                maxX,
                null,
            );
            this._removeProfileMarker();
        };

        canvas.ontouchstart = canvas.ontouchmove = (event) => {
            if (event.touches.length > 0) {
                const touch = event.touches[0];
                const tRect = canvas.getBoundingClientRect();
                const mouseX = touch.clientX - tRect.left;

                if (mouseX >= padding.left && mouseX <= padding.left + chartWidth) {
                    event.preventDefault();
                    const pct = (mouseX - padding.left) / chartWidth;
                    const targetDistance = pct * maxX;

                    let closestIdx = 0;
                    let minDiff = Infinity;
                    for (let i = 0; i < samples.length; i++) {
                        const diff = Math.abs(samples[i].distance - targetDistance);
                        if (diff < minDiff) {
                            minDiff = diff;
                            closestIdx = i;
                        }
                    }

                    const activeSample = samples[closestIdx];
                    this._drawChartWithCrosshair(
                        canvas,
                        ctx,
                        rect.width,
                        rect.height,
                        padding,
                        chartWidth,
                        chartHeight,
                        samples,
                        compareSamples,
                        minY,
                        maxY,
                        maxX,
                        closestIdx,
                    );
                    this._updateProfileMarker(
                        activeSample.cartesian,
                        activeSample.height,
                        compareSamples ? compareSamples[closestIdx].height : null,
                    );
                }
            }
        };

        canvas.ontouchend = () => {
            this._drawChartWithCrosshair(
                canvas,
                ctx,
                rect.width,
                rect.height,
                padding,
                chartWidth,
                chartHeight,
                samples,
                compareSamples,
                minY,
                maxY,
                maxX,
                null,
            );
            this._removeProfileMarker();
        };
    }

    _drawChartWithCrosshair(
        canvas,
        ctx,
        width,
        height,
        padding,
        chartWidth,
        chartHeight,
        samples,
        compareSamples,
        minY,
        maxY,
        maxX,
        closestIdx,
    ) {
        ctx.clearRect(0, 0, width, height);

        const getCanvasX = (x) => padding.left + (x / maxX) * chartWidth;
        const getCanvasY = (y) =>
            padding.top + chartHeight - ((y - minY) / (maxY - minY)) * chartHeight;

        ctx.strokeStyle = "rgba(156, 163, 175, 0.15)";
        ctx.lineWidth = 1;
        ctx.fillStyle = "rgba(156, 163, 175, 0.6)";
        ctx.font = "9px monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        const yTickCount = 4;
        for (let i = 0; i < yTickCount; i++) {
            const val = minY + (i / (yTickCount - 1)) * (maxY - minY);
            const py = getCanvasY(val);

            ctx.beginPath();
            ctx.setLineDash([2, 2]);
            ctx.moveTo(padding.left, py);
            ctx.lineTo(padding.left + chartWidth, py);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillText(`${val.toFixed(0)}m`, padding.left - 6, py);
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const xTickCount = 4;
        for (let i = 0; i < xTickCount; i++) {
            const val = (i / (xTickCount - 1)) * maxX;
            const px = getCanvasX(val);

            let label = `${val.toFixed(0)}m`;
            if (val >= 1000) {
                label = `${(val / 1000).toFixed(2)}km`;
            }
            ctx.fillText(label, px, padding.top + chartHeight + 6);
        }

        // Show/hide HTML legend element
        const legendEl = document.getElementById("profileChartLegend");
        if (legendEl) {
            if (compareSamples) {
                legendEl.classList.remove("hidden");
            } else {
                legendEl.classList.add("hidden");
            }
        }

        // 1. Draw Comparison Fill
        if (compareSamples) {
            const gradCompare = ctx.createLinearGradient(
                0,
                padding.top,
                0,
                padding.top + chartHeight,
            );
            gradCompare.addColorStop(0, CONFIG.CHART.COMPARE_LINE_COLOR_RGBA);
            gradCompare.addColorStop(1, "rgba(249, 115, 22, 0.0)");

            ctx.beginPath();
            ctx.moveTo(getCanvasX(compareSamples[0].distance), padding.top + chartHeight);
            for (let i = 0; i < compareSamples.length; i++) {
                ctx.lineTo(
                    getCanvasX(compareSamples[i].distance),
                    getCanvasY(compareSamples[i].height),
                );
            }
            ctx.lineTo(
                getCanvasX(compareSamples[compareSamples.length - 1].distance),
                padding.top + chartHeight,
            );
            ctx.closePath();
            ctx.fillStyle = gradCompare;
            ctx.fill();
        }

        // 2. Draw Active Fill
        const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
        grad.addColorStop(0, "rgba(99, 102, 241, 0.3)");
        grad.addColorStop(1, "rgba(99, 102, 241, 0.0)");

        ctx.beginPath();
        ctx.moveTo(getCanvasX(samples[0].distance), padding.top + chartHeight);
        for (let i = 0; i < samples.length; i++) {
            ctx.lineTo(getCanvasX(samples[i].distance), getCanvasY(samples[i].height));
        }
        ctx.lineTo(getCanvasX(samples[samples.length - 1].distance), padding.top + chartHeight);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // 3. Draw Comparison Line
        if (compareSamples) {
            ctx.beginPath();
            ctx.strokeStyle = CONFIG.CHART.COMPARE_LINE_COLOR;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            for (let i = 0; i < compareSamples.length; i++) {
                if (i === 0) {
                    ctx.moveTo(
                        getCanvasX(compareSamples[i].distance),
                        getCanvasY(compareSamples[i].height),
                    );
                } else {
                    ctx.lineTo(
                        getCanvasX(compareSamples[i].distance),
                        getCanvasY(compareSamples[i].height),
                    );
                }
            }
            ctx.stroke();
        }

        // 4. Draw Active Line
        ctx.beginPath();
        ctx.strokeStyle = CONFIG.CHART.LINE_COLOR;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (let i = 0; i < samples.length; i++) {
            if (i === 0) {
                ctx.moveTo(getCanvasX(samples[i].distance), getCanvasY(samples[i].height));
            } else {
                ctx.lineTo(getCanvasX(samples[i].distance), getCanvasY(samples[i].height));
            }
        }
        ctx.stroke();

        if (closestIdx !== null && closestIdx >= 0 && closestIdx < samples.length) {
            const cx = getCanvasX(samples[closestIdx].distance);
            const cy = getCanvasY(samples[closestIdx].height);

            ctx.beginPath();
            ctx.strokeStyle = CONFIG.CHART.LINE_COLOR_RGBA;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.moveTo(cx, padding.top);
            ctx.lineTo(cx, padding.top + chartHeight);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.strokeStyle = CONFIG.CHART.LINE_COLOR;
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Dot on comparison line
            if (compareSamples) {
                const cyCompare = getCanvasY(compareSamples[closestIdx].height);
                ctx.beginPath();
                ctx.arc(cx, cyCompare, 5, 0, 2 * Math.PI);
                ctx.fillStyle = "#ffffff";
                ctx.fill();
                ctx.strokeStyle = CONFIG.CHART.COMPARE_LINE_COLOR;
                ctx.lineWidth = 2.5;
                ctx.stroke();
            }

            const textDist =
                samples[closestIdx].distance >= 1000
                    ? `${(samples[closestIdx].distance / 1000).toFixed(2)} km`
                    : `${samples[closestIdx].distance.toFixed(1)} m`;

            let tooltipText = `Dist: ${textDist} | Elev: ${samples[closestIdx].height.toFixed(1)} m`;
            if (compareSamples) {
                const activeH = samples[closestIdx].height;
                const compareH = compareSamples[closestIdx].height;
                tooltipText = `Dist: ${textDist} | Active: ${activeH.toFixed(1)} m | Compare: ${compareH.toFixed(1)} m`;
            }

            ctx.font = "bold 9px sans-serif";
            const textWidth = ctx.measureText(tooltipText).width;
            const boxWidth = textWidth + 10;
            const boxHeight = 16;

            let boxX = cx + 8;
            if (boxX + boxWidth > width - 4) {
                boxX = cx - 8 - boxWidth;
            }
            // Constrain boxX to prevent tooltip from being cut off on the canvas edges
            boxX = Math.max(4, Math.min(width - boxWidth - 4, boxX));
            const boxY = Math.min(
                padding.top + chartHeight - boxHeight - 2,
                Math.max(padding.top + 2, cy - boxHeight / 2),
            );

            ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4);
            } else {
                ctx.rect(boxX, boxY, boxWidth, boxHeight);
            }
            ctx.fill();

            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(tooltipText, boxX + 5, boxY + boxHeight / 2);
        }
    }

    _updateProfileMarker(cartesian, elevation, compareElevation = null) {
        this._removeProfileMarker();

        let labelText = `${elevation.toFixed(1)} m`;
        if (compareElevation !== null && compareElevation !== undefined) {
            const delta = elevation - compareElevation;
            const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
            labelText = `Active: ${elevation.toFixed(1)} m\nCompare: ${compareElevation.toFixed(1)} m\nΔ: ${deltaStr} m`;
        }

        this.profileMarkerEntity = this.viewer.entities.add({
            name: "Profile Location Highlight",
            position: cartesian,
            point: {
                pixelSize: 10,
                color: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString(CONFIG.CHART.LINE_COLOR),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
                text: labelText,
                font: "bold 11px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2.5,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
        this.viewer.scene.requestRender();
    }

    _removeProfileMarker() {
        if (this.profileMarkerEntity) {
            this.viewer.entities.remove(this.profileMarkerEntity);
            this.profileMarkerEntity = null;
            this.viewer.scene.requestRender();
        }
    }

    clearProfile() {
        this.disableProfileDrawMode();

        if (this.profilePolylineEntity) {
            this.viewer.entities.remove(this.profilePolylineEntity);
            this.profilePolylineEntity = null;
        }

        this.profilePointEntities.forEach((ent) => {
            this.viewer.entities.remove(ent);
        });
        this.profilePointEntities = [];

        this.profileLabelEntities.forEach((ent) => {
            this.viewer.entities.remove(ent);
        });
        this.profileLabelEntities = [];

        this._removeProfileMarker();

        this.profilePoints = [];
        this.profileHoverPoint = null;

        const profileDrawBtnText = document.getElementById("profileDrawBtnText");
        const profileDrawBtn = document.getElementById("profileDrawBtn");
        if (profileDrawBtnText) profileDrawBtnText.textContent = "Draw profile line";
        if (profileDrawBtn) {
            applyBtnStyle(profileDrawBtn, "primary");
        }

        const profileGenerateBtn = document.getElementById("profileGenerateBtn");
        if (profileGenerateBtn) profileGenerateBtn.setAttribute("disabled", "true");

        const compareStatsSection = document.getElementById("profileCompareStatsSection");
        const deltaStatsSection = document.getElementById("profileDeltaStatsSection");
        const legendEl = document.getElementById("profileChartLegend");

        if (compareStatsSection) compareStatsSection.classList.add("hidden");
        if (deltaStatsSection) deltaStatsSection.classList.add("hidden");
        if (legendEl) legendEl.classList.add("hidden");

        const resultsSection = document.getElementById("profileResultsSection");
        if (resultsSection) resultsSection.classList.add("hidden");

        this.viewer.scene.requestRender();
    }

    disableProfileMode() {
        const wasDrawing = this.profileMode;
        this.disableProfileDrawMode();
        if (wasDrawing) {
            this.clearProfile();
        }

        const panel = document.getElementById("analysisPanel");
        if (panel) {
            panel.classList.remove("active");
        }

        if (this.activeMeasureMode === "profile") {
            this.activeMeasureMode = null;
            this._updateMeasureUI();
        }
    }

    /**
     * Layer id of the terrain on the globe. Stored in the map store (activeTerrainId) so the layer
     * list and the React chrome see the same value.
     */
    get loadedTerrainId() {
        return this._destroyed ? null : mapStore.getState().activeTerrainId;
    }

    set loadedTerrainId(layerId) {
        if (this._destroyed) return; // late async results of a destroyed viewer
        mapStore.setState({ activeTerrainId: layerId == null ? null : String(layerId) });
    }

    /** Publishes the ids of the vector layers that are shown to the map store (visibleVectorIds). */
    _publishVisibleVectors() {
        if (this._destroyed) return;
        const visible = [];
        this.activeVectorLayers.forEach((data, layerId) => {
            const collections = data.collections || data;
            if (collections && collections.length > 0 && collections[0].show) visible.push(String(layerId));
        });
        mapStore.setState({ visibleVectorIds: visible });
    }

    destroy() {
        // Idempotent: the page can be unmounted (client-side navigation) and mounted again.
        if (this._destroyed) return;
        this._destroyed = true;

        this.performanceController.destroy();
        this.terrainCache.clear();
        if (this._coordPickerClickHandler) {
            this._coordPickerClickHandler.destroy();
            this._coordPickerClickHandler = null;
        }
        // Stop browser APIs that would keep calling into a destroyed viewer.
        if (this.watchId !== null) {
            navigator.geolocation?.clearWatch(this.watchId);
            this.watchId = null;
        }
        if (this.deviceOrientationHandler) {
            window.removeEventListener("deviceorientation", this.deviceOrientationHandler, false);
            this.deviceOrientationHandler = null;
            this.deviceCompassActive = false;
        }
        [this._pivotClickHandler, this._featurePickingHandler, this._mousePositionHandler].forEach(
            (handler) => {
                if (handler && !handler.isDestroyed()) handler.destroy();
            },
        );
        this._pivotClickHandler = null;
        this._featurePickingHandler = null;
        this._mousePositionHandler = null;
        if (this.activeDrawer) {
            this.activeDrawer.clear();
            this.activeDrawer = null;
        }
        this.clearCutFill();
        this.clearProfile();
        if (this.viewer) {
            try {
                this.viewer.destroy();
            } catch (e) {
                console.warn("Error destroying Cesium viewer:", e);
            }
            this.viewer = null;
        }
        this.activeVectorLayers.clear();
    }
}

/**
 * Show/hide state of a layer card's toggle, from the map store.
 * @returns {"visible"|"hidden"|"pending"}
 */
function layerToggleState(state, layerId, layerType) {
    if (state.pendingLayerIds.includes(layerId)) return "pending";
    const visible =
        layerType === "terrain"
            ? state.activeTerrainId === layerId
            : state.visibleVectorIds.includes(layerId);
    return visible ? "visible" : "hidden";
}

/**
 * Main Application Logic
 *
 * Was a DOMContentLoaded handler in Laravel; src/lib/map/mount.js calls it once the page markup
 * is in the DOM. Every listener goes through addManagedListener, so the returned cleanup()
 * (Laravel: window.cleanupMapListeners()) removes all of them.
 *
 * @returns {{ controller: CesiumMapController, cleanup: () => void }}
 */
export function initMapPage() {
    // Initialize Map
    const mapController = new CesiumMapController("cesiumContainer");
    let disposed = false;

    // Managed event listeners for SPA-readiness
    const _managedListeners = [];
    function addManagedListener(element, type, handler, options) {
        if (element) {
            element.addEventListener(type, handler, options);
            _managedListeners.push({ element, type, handler, options });
        }
    }

    function cleanupMapListeners() {
        disposed = true;
        _managedListeners.forEach(({ element, type, handler, options }) => {
            if (element && typeof element.removeEventListener === "function") {
                element.removeEventListener(type, handler, options);
            }
        });
        _managedListeners.length = 0;
    }

    /** Store subscription removed with the managed listeners. */
    function subscribeStore(listener) {
        const unsubscribe = mapStore.subscribe(listener);
        _managedListeners.push({
            element: { removeEventListener: unsubscribe },
            type: "store",
            handler: null,
        });
    }

    // Opening or closing a side panel ends coordinate picking (Laravel closeAllPanels()).
    subscribeStore((state, previous) => {
        if (state.activePanel !== previous.activePanel) mapController.disableCoordinatePickerMode();
    });

    // Layer cards: the show/hide icon follows the store (terrain on the globe, visible vectors,
    // running requests). The list itself is rendered by src/lib/map/map-page.js.
    function syncLayerToggleIcons() {
        const state = mapStore.getState();
        document.querySelectorAll("#allLayersList .layer-card-item").forEach((card) => {
            const button = card.querySelector(".map-layer-toggle");
            if (!button || !card.dataset.id) return;
            const layerType = button.classList.contains("toggle-terrain-btn") ? "terrain" : "vector";
            setLayerToggleIcon(button, layerToggleState(state, card.dataset.id, layerType));
        });
    }
    subscribeStore((state, previous) => {
        if (
            state.activeTerrainId !== previous.activeTerrainId ||
            state.visibleVectorIds !== previous.visibleVectorIds ||
            state.pendingLayerIds !== previous.pendingLayerIds
        ) {
            syncLayerToggleIcons();
        }
    });

    /** Marks a layer's show/hide request as running (spinner) or finished. */
    function setLayerPending(layerId, pending) {
        if (!disposed) mapStore.getState().setLayerPending(layerId, pending);
    }

    addManagedListener(document.getElementById("closeFeaturePropertiesBtn"), "click", () =>
        mapController.hideFeatureProperties(),
    );

    // Event Listener
    addManagedListener(document.getElementById("zoomInBtn"), "click", () => mapController.zoomIn());
    addManagedListener(document.getElementById("zoomOutBtn"), "click", () =>
        mapController.zoomOut(),
    );
    addManagedListener(document.getElementById("compassBtn"), "click", () =>
        mapController.handleCompassClick(),
    );
    addManagedListener(document.getElementById("coordinatePickerBtn"), "click", () => {
        const isPicking = mapController.coordPickerMode;
        if (isPicking) {
            mapController.disableCoordinatePickerMode();
        } else {
            mapController.enableCoordinatePickerMode();
        }
    });
    // Measure toolbar
    mapController.initCutFillPanelUI();
    mapController.initProfilePanelUI();

    const measureTools = {
        measureDistanceHorizBtn: () => mapController.toggleDistanceMeasure(),
        measureDistanceSurfBtn: () => mapController.toggleDistanceSurfaceMeasure(),
        measureAreaHorizBtn: () => mapController.toggleAreaMeasure(),
        measureAreaSurfBtn: () => mapController.toggleAreaSurfaceMeasure(),
        measureCircleBtn: () => mapController.toggleCircleMeasure(),
        measureAnalysisBtn: () => mapController.toggleAnalysisMode(),
    };
    Object.entries(measureTools).forEach(([id, handler]) => {
        addManagedListener(document.getElementById(id), "click", handler);
    });

    // Vanilla tabs for the analysis panel and the help popover
    document.querySelectorAll('[role="tablist"]').forEach((tablist) => {
        const tabs = [...tablist.querySelectorAll('[role="tab"]')];
        tabs.forEach((tab) => {
            addManagedListener(tab, "click", () => {
                tabs.forEach((other) => {
                    const selected = other === tab;
                    other.setAttribute("aria-selected", String(selected));
                    document.getElementById(other.getAttribute("aria-controls"))?.classList.toggle("hidden", !selected);
                });
            });
        });
    });

    const helpPanel = document.getElementById("cesiumHelpPanel");
    const measurePanel = document.getElementById("measurePanel");
    const setMeasurePanelOpen = (open) => {
        if (!measurePanel) return;
        measurePanel.classList.toggle("opacity-0", !open);
        measurePanel.classList.toggle("pointer-events-none", !open);
        measurePanel.classList.toggle("scale-95", !open);
        document.getElementById("measureToggleBtn")?.setAttribute("aria-expanded", String(open));
    };
    const setHelpPanelOpen = (open) => {
        helpPanel?.classList.toggle("hidden", !open);
        document.getElementById("helpBtn")?.setAttribute("aria-expanded", String(open));
    };

    addManagedListener(document.getElementById("measureToggleBtn"), "click", (e) => {
        e.stopPropagation();
        const isOpening = measurePanel?.classList.contains("opacity-0");
        if (isOpening) {
            setHelpPanelOpen(false);
            const analysisPanel = document.getElementById("analysisPanel");
            if (analysisPanel?.classList.contains("active")) {
                mapController.disableCutFillMode();
                mapController.disableProfileMode();
            }
        }
        setMeasurePanelOpen(isOpening);
    });

    addManagedListener(document.getElementById("helpBtn"), "click", (e) => {
        e.stopPropagation();
        setMeasurePanelOpen(false);
        setHelpPanelOpen(Boolean(helpPanel?.classList.contains("hidden")));
    });
    addManagedListener(document.getElementById("closeHelpPanelBtn"), "click", () => {
        setHelpPanelOpen(false);
    });

    // Close the floating measure/help popovers on outside click or Escape
    addManagedListener(document, "click", (e) => {
        if (measurePanel && !e.target.closest("#measurePanel, #measureToggleBtn")) setMeasurePanelOpen(false);
        if (helpPanel && !e.target.closest("#cesiumHelpPanel, #helpBtn")) setHelpPanelOpen(false);
    });
    addManagedListener(document, "keydown", (e) => {
        if (e.key !== "Escape") return;
        setMeasurePanelOpen(false);
        setHelpPanelOpen(false);
    });

    addManagedListener(document.getElementById("closeCoordinatePickerPopupBtn"), "click", () => {
        mapController.disableCoordinatePickerMode();
    });
    addManagedListener(document.getElementById("pivotCamBtn"), "click", () => {
        mapController.togglePivotCamera();
    });
    addManagedListener(document.getElementById("geolocationBtn"), "click", () => {
        mapController.toggleGeolocation();
    });
    addManagedListener(document.getElementById("depthTestToggle"), "click", () => {
        mapController.toggleDepthTestAgainstTerrain();
    });
    addManagedListener(document.getElementById("trackingBtn"), "click", () => {
        mapController.toggleDeviceCompass();
    });

    // Compass widget rotation loop
    const removePostRender = mapController.viewer.scene.postRender.addEventListener(() => {
        const compassIcon = document.getElementById("compassIcon");
        if (compassIcon) {
            const heading = mapController.getHeadingDegrees();
            compassIcon.style.transform = `rotate(-${heading}deg)`;
        }
    });

    _managedListeners.push({
        element: {
            removeEventListener: () => {
                try {
                    removePostRender();
                } catch (e) {
                    console.warn("Failed to remove postRender listener:", e);
                }
            },
        },
        type: "postRender",
        handler: null,
    });

    // Shared Handlers for Terrain and Vector Layers
    async function handleTerrainToggle(item, btn) {
        if (mapController.isTogglingTerrain) return;
        mapController.isTogglingTerrain = true;

        const layerId = item.dataset.id;
        setLayerPending(layerId, true);
        if (btn) btn.disabled = true;

        const terrainUrl = item.dataset.terrainUrl;
        const hasOrtho = item.dataset.hasOrtho === "true";
        const hasOrthoTiles = item.dataset.hasOrthoTiles === "true";
        const orthoTilesUrl = item.dataset.orthoTilesUrl;
        const orthoTilesMinZoom = item.dataset.orthoTilesMinZoom || 10;
        const orthoTilesMaxZoom = item.dataset.orthoTilesMaxZoom || 18;

        let bbox = {};
        try {
            bbox = JSON.parse(item.dataset.bbox || "{}");
        } catch (err) {
            console.error("Error parsing bbox:", err);
        }

        const isCurrentlyActive = mapController.loadedTerrainId === layerId;

        try {
            if (isCurrentlyActive) {
                mapController.resetTerrain();
                mapController.removeImageryLayer();
            } else {
                const success = await mapController.loadTerrain(layerId, terrainUrl);
                if (!success) {
                    mapController.resetTerrain();
                    mapController.removeImageryLayer();
                    return;
                }
                if (hasOrtho && hasOrthoTiles && orthoTilesUrl) {
                    mapController.addXYZImagery(
                        orthoTilesUrl,
                        bbox,
                        orthoTilesMinZoom,
                        orthoTilesMaxZoom,
                    );
                } else {
                    mapController.removeImageryLayer();
                }
            }
        } finally {
            mapController.isTogglingTerrain = false;
            if (btn) btn.disabled = false;
            setLayerPending(layerId, false);
        }
    }

    function handleTerrainFocus(item) {
        let bbox = {};
        try {
            bbox = JSON.parse(item.dataset.bbox || "{}");
        } catch (err) {
            console.error("Error parsing bbox:", err);
        }
        mapController.flyToBoundingBox(bbox);
    }

    async function handleVectorToggle(item, btn) {
        const layerId = item.dataset.id;
        const vectorUrl = `/geodata/vector/${layerId}/data.json`;
        // The toggle icon follows mapStore (spinner while pending, then eye / eye-off).
        setLayerPending(layerId, true);
        btn.disabled = true;

        try {
            const style = {
                color: item.dataset.categoryColor,
                iconUrl: item.dataset.categoryIconUrl,
                labelField: item.dataset.labelField,
                categoryName: item.dataset.categoryName,
            };
            const isNowVisible = await mapController.loadVector(layerId, vectorUrl, style);

            // Sync settings button and populate dropdown in both lists
            document.querySelectorAll(`.layer-card-item`).forEach((card) => {
                if (card.dataset.id === layerId) {
                    const configBtn = card.querySelector(".configure-vector-btn");
                    const settingsPanel = card.querySelector(".vector-settings-panel");
                    const select = card.querySelector(".label-field-select");

                    if (isNowVisible) {
                        if (configBtn) configBtn.classList.remove("hidden");
                        if (select) {
                            const keys = mapController.getVectorPropertyKeys(layerId);
                            if (select.options.length <= 1 && keys.length > 0) {
                                select.innerHTML = '<option value="">No label</option>';
                                const activeField =
                                    card.dataset.labelField !== undefined
                                        ? card.dataset.labelField
                                        : "";

                                if (card.dataset.labelField === undefined) {
                                    card.dataset.labelField = activeField;
                                }

                                keys.forEach((key) => {
                                    const opt = document.createElement("option");
                                    opt.value = key;
                                    opt.textContent = key;
                                    if (key === activeField) {
                                        opt.selected = true;
                                    }
                                    select.appendChild(opt);
                                });
                            } else if (select.options.length > 1) {
                                select.value = card.dataset.labelField || "";
                            }
                        }
                    } else {
                        if (configBtn) configBtn.classList.add("hidden");
                        if (settingsPanel) settingsPanel.classList.add("hidden");
                    }
                }
            });
        } catch (err) {
            console.error("Error toggling vector:", err);
        } finally {
            btn.disabled = false;
            setLayerPending(layerId, false);
        }
    }

    function handleLabelFieldChange(item, fieldName) {
        const layerId = item.dataset.id;

        item.dataset.labelField = fieldName;

        document.querySelectorAll(`.layer-card-item`).forEach((card) => {
            if (card.dataset.id === layerId) {
                card.dataset.labelField = fieldName;
                const select = card.querySelector(".label-field-select");
                if (select) {
                    select.value = fieldName;
                }
            }
        });

        mapController.changeVectorLabelField(layerId, fieldName);
    }

    function handleVectorFocus(item) {
        const layerId = item.dataset.id;
        let bbox = {};
        try {
            bbox = JSON.parse(item.dataset.bbox || "{}");
        } catch (err) {
            console.error("Error parsing vector bbox:", err);
        }

        if (bbox && (bbox.west || bbox.minx || bbox.minX)) {
            mapController.flyToBoundingBox(bbox);
        } else {
            mapController.zoomToVector(layerId);
        }
    }

    // All Layers Listeners (Event Delegation for Terrain and Vector)
    const allLayersList = document.getElementById("allLayersList");
    if (allLayersList) {
        addManagedListener(allLayersList, "click", async (e) => {
            const btn = e.target.closest("button");
            if (!btn) return;

            const item = btn.closest(".layer-card-item");
            if (!item) return;

            // Terrain handlers
            if (btn.classList.contains("toggle-terrain-btn")) {
                await handleTerrainToggle(item, btn);
            }
            if (btn.classList.contains("focus-terrain-btn")) {
                mapController._disablePivotMode();
                handleTerrainFocus(item);
            }

            // Vector handlers
            if (btn.classList.contains("toggle-vector-btn")) {
                await handleVectorToggle(item, btn);
            }
            if (btn.classList.contains("focus-vector-btn")) {
                handleVectorFocus(item);
            }
            if (btn.classList.contains("configure-vector-btn")) {
                const settingsPanel = item.querySelector(".vector-settings-panel");
                if (settingsPanel) {
                    settingsPanel.classList.toggle("hidden");
                }
            }
        });

        addManagedListener(allLayersList, "change", (e) => {
            if (e.target.matches(".label-field-select")) {
                const item = e.target.closest(".layer-card-item");
                if (!item) return;
                handleLabelFieldChange(item, e.target.value);
            }
        });
    }

    addManagedListener(document, "vectorLayersRendered", () => {
        document.querySelectorAll(".layer-card-item").forEach((card) => {
            const layerId = card.dataset.id;
            if (layerId && mapController.activeVectorLayers.has(layerId)) {
                const vectorData = mapController.activeVectorLayers.get(layerId);
                const collections = vectorData.collections || vectorData;
                const isNowVisible = collections && collections.length > 0 && collections[0].show;

                const configBtn = card.querySelector(".configure-vector-btn");
                const settingsPanel = card.querySelector(".vector-settings-panel");
                const select = card.querySelector(".label-field-select");

                if (isNowVisible) {
                    if (configBtn) configBtn.classList.remove("hidden");
                    if (select) {
                        const keys = mapController.getVectorPropertyKeys(layerId);
                        if (select.options.length <= 1 && keys.length > 0) {
                            select.innerHTML = '<option value="">No label</option>';
                            const activeField =
                                card.dataset.labelField !== undefined
                                    ? card.dataset.labelField
                                    : vectorData.style?.labelField || "";

                            if (card.dataset.labelField === undefined) {
                                card.dataset.labelField = activeField;
                            }

                            keys.forEach((key) => {
                                const opt = document.createElement("option");
                                opt.value = key;
                                opt.textContent = key;
                                if (key === activeField) {
                                    opt.selected = true;
                                }
                                select.appendChild(opt);
                            });
                        } else if (select.options.length > 1) {
                            select.value =
                                card.dataset.labelField || vectorData.style?.labelField || "";
                        }
                    }
                } else {
                    if (configBtn) configBtn.classList.add("hidden");
                    if (settingsPanel) settingsPanel.classList.add("hidden");
                }
            }
        });
    });

    return { controller: mapController, cleanup: cleanupMapListeners };
}

export { CesiumMapController, CONFIG };
