/**
 * Interactive point/line/polygon/circle drawing with undo and vertex snapping
 * (port of resources/js/cesium-drawer.js, unchanged).
 */
import * as Cesium from "cesium";

export class CesiumMapDrawer {
    constructor(viewer, options = {}) {
        this.viewer = viewer;
        this.mode = options.mode || "line"; // "line", "polygon", or "point"
        this.color = options.color || "#f97316";
        this.minPoints =
            options.minPoints || (this.mode === "polygon" ? 3 : this.mode === "point" ? 1 : 2);
        this.onComplete = options.onComplete || (() => {});
        this.enableSnap = options.enableSnap === true;
        this.clampGround = options.clampGround || false;
        this.showLabels = options.showLabels !== false;
        this.onPointsChange = options.onPointsChange || null;
        // Object with findNearestVectorVertex / updateSnapIndicator / hideSnapIndicator
        // (the CesiumMapController); Laravel used window.mapController.
        this.snapProvider = options.snapProvider || null;

        this.points = [];
        this.hoverPoint = null;
        this.handler = null;
        this.active = false;

        // Entities created during drawing
        this.polylineEntity = null;
        this.polygonEntity = null;
        this.circleEntity = null;
        this.vertexEntities = [];
        this.labelEntities = [];

        // Determine whether terrain is available for clampToGround / classification
        this._terrainAvailable = this._checkTerrainAvailable();
    }

    _checkTerrainAvailable() {
        const tp = this.viewer.terrainProvider;
        if (!tp || tp instanceof Cesium.EllipsoidTerrainProvider) {
            return false;
        }
        if (!navigator.onLine) {
            return false;
        }
        return true;
    }

    get _heightRef() {
        return this.clampGround && this._terrainAvailable
            ? Cesium.HeightReference.CLAMP_TO_GROUND
            : Cesium.HeightReference.NONE;
    }

    get _clampToGround() {
        return this.clampGround && this._terrainAvailable;
    }

    get _classificationType() {
        if (!this.clampGround) return undefined;
        return this._terrainAvailable
            ? Cesium.ClassificationType.TERRAIN
            : Cesium.ClassificationType.BOTH;
    }

    start() {
        this.clear();
        this.active = true;
        this.viewer.canvas.style.cursor = "crosshair";
        this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

        // LEFT_CLICK: Add point
        this.handler.setInputAction((movement) => {
            const cartesian = this._pickGlobePosition(movement.position);
            if (!Cesium.defined(cartesian)) return;

            this.points.push(cartesian);
            this._addVertexEntity(cartesian);
            this._updateLabels();

            if (this.points.length === 1) {
                if (this.mode === "point") {
                    this.complete();
                    return;
                }
                this._createDrawingEntities();
            } else if (this.points.length === 2 && this.mode === "circle") {
                this.complete();
                return;
            }
            this._updateUndoButtonVisibility();
            this.viewer.scene.requestRender();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // MOUSE_MOVE: Update hover point and snap indicator
        this.handler.setInputAction((movement) => {
            const cartesian = this._pickGlobePosition(movement.endPosition);
            if (this.points.length > 0 && Cesium.defined(cartesian)) {
                this.hoverPoint = cartesian;
                this._updateLabels();
                this.viewer.scene.requestRender();
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // RIGHT_CLICK or LEFT_DOUBLE_CLICK: Complete drawing
        const handleComplete = () => this.complete();
        this.handler.setInputAction(handleComplete, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        this.handler.setInputAction(handleComplete, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }

    complete() {
        // Remove duplicate points at the end of the array (typically caused by double click)
        while (this.points.length >= 2) {
            const pLast = this.points[this.points.length - 1];
            const pPrev = this.points[this.points.length - 2];
            if (Cesium.Cartesian3.distance(pLast, pPrev) < 0.1) {
                this.points.pop();
                const lastVertex = this.vertexEntities.pop();
                if (lastVertex) this.viewer.entities.remove(lastVertex);
            } else {
                break;
            }
        }

        if (this.points.length < this.minPoints) {
            alert(`Minimal gambar ${this.minPoints} titik`);
            return false;
        }

        this.onComplete(this.points);
        this.stop();
        return true;
    }

    undo() {
        if (this.points.length === 0) return;

        // Pop last point
        this.points.pop();

        // Remove last vertex entity
        const lastVertex = this.vertexEntities.pop();
        if (lastVertex) {
            this.viewer.entities.remove(lastVertex);
        }

        // Update labels
        this._updateLabels();

        // If no points left, remove drawing entities
        if (this.points.length === 0) {
            this._removeDrawingEntities();
        }

        this._updateUndoButtonVisibility();
        this.viewer.scene.requestRender();
    }

    _updateUndoButtonVisibility() {
        const undoBtn = document.getElementById("drawingControlUndoBtn");
        if (undoBtn) {
            if (this.points.length > 0) {
                undoBtn.classList.remove("hidden");
            } else {
                undoBtn.classList.add("hidden");
            }
        }
    }

    stop() {
        this.active = false;
        this.viewer.canvas.style.cursor = "default";
        if (this.handler) {
            this.handler.destroy();
            this.handler = null;
        }
        this.hoverPoint = null;
        this._removeDrawingEntities();

        this.snapProvider?.hideSnapIndicator?.();

        const undoBtn = document.getElementById("drawingControlUndoBtn");
        if (undoBtn) {
            undoBtn.classList.add("hidden");
        }
    }

    clear() {
        this.stop();
        this.points = [];
    }

    _pickGlobePosition(screenPosition) {
        // Try to snap to nearest vector vertex if a snap provider is set and snapping is enabled
        const snapProvider = this.snapProvider;
        if (this.enableSnap && typeof snapProvider?.findNearestVectorVertex === "function") {
            const snapped = snapProvider.findNearestVectorVertex(screenPosition);
            if (snapped) {
                snapProvider.updateSnapIndicator?.(snapped.cartesian);
                const cartesian = Cesium.Cartesian3.clone(snapped.cartesian);
                cartesian.isSnapped = true;
                cartesian.snappedAltitude = snapped.altitude;
                return cartesian;
            }
        }

        // Hide snap indicator if we didn't snap
        snapProvider?.hideSnapIndicator?.();

        let cartesian;
        if (this.viewer.scene.mode === Cesium.SceneMode.SCENE3D) {
            const ray = this.viewer.camera.getPickRay(screenPosition);
            cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
        }
        if (!Cesium.defined(cartesian)) {
            cartesian = this.viewer.camera.pickEllipsoid(
                screenPosition,
                this.viewer.scene.globe.ellipsoid,
            );
        }
        return cartesian;
    }

    _addVertexEntity(position) {
        const isSnapped = position && position.isSnapped;
        const heightRef =
            this._hasSnapped || isSnapped ? Cesium.HeightReference.NONE : this._heightRef;
        const entity = this.viewer.entities.add({
            position: position,
            point: {
                pixelSize: 6,
                color: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString(this.color),
                outlineWidth: 1.5,
                heightReference: heightRef,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
        this.vertexEntities.push(entity);
    }

    _createDrawingEntities() {
        if (this.mode === "point") {
            return;
        }
        if (this.mode === "circle") {
            this.polylineEntity = this.viewer.entities.add({
                name: "Drawing Radius Line",
                polyline: {
                    positions: new Cesium.CallbackProperty(() => {
                        const pts = [...this.points];
                        if (this.hoverPoint) {
                            pts.push(this.hoverPoint);
                        }
                        return pts;
                    }, false),
                    width: 2,
                    material: Cesium.Color.fromCssColorString(this.color),
                    clampToGround: this._clampToGround,
                },
            });

            this.circleEntity = this.viewer.entities.add({
                name: "Drawing Circle Area",
                position: new Cesium.CallbackProperty(() => this.points[0], false),
                ellipse: {
                    semiMajorAxis: new Cesium.CallbackProperty(() => {
                        const center = this.points[0];
                        const perimeter =
                            this.hoverPoint || (this.points.length > 1 ? this.points[1] : null);
                        if (!center || !perimeter) return 0.01;
                        const c1 = Cesium.Cartographic.fromCartesian(center);
                        const c2 = Cesium.Cartographic.fromCartesian(perimeter);
                        const geodesic = new Cesium.EllipsoidGeodesic(c1, c2);
                        return geodesic.surfaceDistance;
                    }, false),
                    semiMinorAxis: new Cesium.CallbackProperty(() => {
                        const center = this.points[0];
                        const perimeter =
                            this.hoverPoint || (this.points.length > 1 ? this.points[1] : null);
                        if (!center || !perimeter) return 0.01;
                        const c1 = Cesium.Cartographic.fromCartesian(center);
                        const c2 = Cesium.Cartographic.fromCartesian(perimeter);
                        const geodesic = new Cesium.EllipsoidGeodesic(c1, c2);
                        return geodesic.surfaceDistance;
                    }, false),
                    material: Cesium.Color.fromCssColorString(this.color).withAlpha(0.25),
                    outline: true,
                    outlineColor: Cesium.Color.fromCssColorString(this.color),
                    outlineWidth: 2,
                    classificationType: this._classificationType,
                    heightReference: this._heightRef,
                    height: new Cesium.CallbackProperty(() => {
                        const center = this.points[0];
                        if (!center) return 0;
                        const carto = Cesium.Cartographic.fromCartesian(center);
                        return carto.height;
                    }, false),
                },
            });
            return;
        }
        this.polylineEntity = this.viewer.entities.add({
            name: "Drawing Line",
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    const pts = [...this.points];
                    if (this.hoverPoint) {
                        pts.push(this.hoverPoint);
                    }
                    if (this.mode === "polygon" && pts.length > 1) {
                        pts.push(this.points[0]); // Visual loop closure
                    }
                    return pts.length >= 2 ? pts : undefined;
                }, false),
                width: this.mode === "polygon" ? 2 : 3,
                material: Cesium.Color.fromCssColorString(this.color),
                clampToGround: this._clampToGround,
            },
        });

        if (this.mode === "polygon") {
            this.polygonEntity = this.viewer.entities.add({
                name: "Drawing Area",
                polygon: {
                    hierarchy: new Cesium.CallbackProperty(() => {
                        const pts = [...this.points];
                        if (this.hoverPoint) {
                            pts.push(this.hoverPoint);
                        }
                        return pts.length >= 3 ? new Cesium.PolygonHierarchy(pts) : undefined;
                    }, false),
                    material: Cesium.Color.fromCssColorString(this.color).withAlpha(0.25),
                    classificationType: this._classificationType,
                    perPositionHeight: !this._clampToGround,
                },
            });
        }
    }

    _removeDrawingEntities() {
        if (this.polylineEntity) {
            this.viewer.entities.remove(this.polylineEntity);
            this.polylineEntity = null;
        }
        if (this.polygonEntity) {
            this.viewer.entities.remove(this.polygonEntity);
            this.polygonEntity = null;
        }
        if (this.circleEntity) {
            this.viewer.entities.remove(this.circleEntity);
            this.circleEntity = null;
        }
        this.vertexEntities.forEach((e) => this.viewer.entities.remove(e));
        this.vertexEntities = [];
        this.labelEntities.forEach((e) => this.viewer.entities.remove(e));
        this.labelEntities = [];
    }

    _updateLabels() {
        const pts = [...this.points];
        if (this.hoverPoint) {
            pts.push(this.hoverPoint);
        }

        // Dynamically adjust clampToGround and perPositionHeight based on snapping
        const hasSnapped = pts.some((p) => p && p.isSnapped);
        this._hasSnapped = hasSnapped;

        if (this.polylineEntity && this.polylineEntity.polyline) {
            this.polylineEntity.polyline.clampToGround = hasSnapped
                ? false
                : this.clampGround && this._terrainAvailable;
        }
        if (this.polygonEntity && this.polygonEntity.polygon) {
            if (hasSnapped) {
                this.polygonEntity.polygon.perPositionHeight = true;
                this.polygonEntity.polygon.classificationType = undefined;
            } else {
                this.polygonEntity.polygon.perPositionHeight = !(
                    this.clampGround && this._terrainAvailable
                );
                this.polygonEntity.polygon.classificationType =
                    this.clampGround && this._terrainAvailable
                        ? Cesium.ClassificationType.TERRAIN
                        : Cesium.ClassificationType.BOTH;
            }
        }

        // Dynamically update heightReference of all vertex entities to align with polyline/polygon clampToGround
        if (this.vertexEntities && this.vertexEntities.length > 0) {
            this.vertexEntities.forEach((entity, idx) => {
                const pt = this.points[idx];
                const isSnapped = pt && pt.isSnapped;
                const expectedHeightRef =
                    hasSnapped || isSnapped ? Cesium.HeightReference.NONE : this._heightRef;
                if (entity.point) {
                    entity.point.heightReference = expectedHeightRef;
                }
            });
        }

        if (this.onPointsChange) {
            this.onPointsChange(pts);
        }

        if (!this.showLabels) return;

        this.labelEntities.forEach((e) => this.viewer.entities.remove(e));
        this.labelEntities = [];

        let totalDistance = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i];
            const p2 = pts[i + 1];
            totalDistance += Cesium.Cartesian3.distance(p1, p2);
            this._createSegmentLabel(p1, p2);
        }

        if (this.mode === "polygon" && this.points.length >= 2 && this.hoverPoint) {
            this._createSegmentLabel(this.hoverPoint, this.points[0]);
        }

        if (this.mode === "line" && pts.length >= 2) {
            const lastPoint = pts[pts.length - 1];
            this._createTotalLabel(lastPoint, totalDistance);
        }
    }

    _createSegmentLabel(p1, p2) {
        const distance = Cesium.Cartesian3.distance(p1, p2);
        if (distance < 0.1) return;

        const midPoint = Cesium.Cartesian3.midpoint(p1, p2, new Cesium.Cartesian3());
        const text =
            distance >= 1000 ? `${(distance / 1000).toFixed(2)} km` : `${distance.toFixed(2)} m`;

        const labelHeightRef = this._hasSnapped ? Cesium.HeightReference.NONE : this._heightRef;

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
                heightReference: labelHeightRef,
                scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.0, 1.5e6, 0.5),
            },
        });
        this.labelEntities.push(label);
    }

    _createTotalLabel(position, totalDistance) {
        if (totalDistance < 0.1) return;

        const text =
            totalDistance >= 1000
                ? `Total: ${(totalDistance / 1000).toFixed(2)} km`
                : `Total: ${totalDistance.toFixed(2)} m`;

        const labelHeightRef = this._hasSnapped ? Cesium.HeightReference.NONE : this._heightRef;

        const label = this.viewer.entities.add({
            position: position,
            label: {
                text: text,
                font: "bold 12px sans-serif",
                fillColor: Cesium.Color.fromCssColorString(this.color),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: new Cesium.Color(0.04, 0.05, 0.06, 0.95),
                backgroundPadding: new Cesium.Cartesian2(6, 4),
                pixelOffset: new Cesium.Cartesian2(0, -25),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: labelHeightRef,
                scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.0, 1.5e6, 0.5),
            },
        });
        this.labelEntities.push(label);
    }
}
