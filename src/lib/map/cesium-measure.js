/* eslint-disable @typescript-eslint/no-unused-vars -- legacy code ported verbatim from the Laravel app */
/**
 * Distance, surface distance, area, surface area and circle measures built on the drawer
 * (port of resources/js/cesium-measure.js, unchanged).
 */
import * as Cesium from "cesium";
import { CesiumMapDrawer } from "./cesium-drawer";
import { UTM_EPSG, UTM_DEF, WGS84_EPSG } from "./utils/constants";

class Measure {
    constructor(viewer, options = {}) {
        this.viewer = viewer;
        this.options = options;
        this.drawer = null;
        this.labels = [];
        this.active = false;
        this.points = [];
        this.polylineEntity = null;
        this.polygonEntity = null;
        this.circleEntity = null;

        // Subclass overrides
        this.isPolygon = false;
        this.clampToGround = false;
        this.isCircle = false;
    }

    start() {
        this.active = true;
        this.drawer = new CesiumMapDrawer(this.viewer, {
            mode: this.isCircle ? "circle" : this.isPolygon ? "polygon" : "line",
            color: "#f0e40a",
            enableSnap: true,
            snapProvider: this.options.snapProvider,
            showLabels: false,
            clampGround: this.clampToGround,
            onComplete: (points) => {
                const uniquePoints = this._filterDuplicatePositions(points);
                this.points = uniquePoints;
                this.updateLabels(uniquePoints, false);
                if (this.options.onEnd) {
                    this.options.onEnd(null);
                }
            },
        });

        this.drawer.onPointsChange = (points) => {
            const uniquePoints = this._filterDuplicatePositions(points);
            this.points = uniquePoints;
            this.updateLabels(uniquePoints, true);
        };

        this.drawer.start();
    }

    end() {
        this.active = false;
        if (this.drawer) {
            this.drawer.clear();
            this.drawer = null;
        }
        this.clearLabels();
        this._removeGraphics();
        this.points = [];
    }

    clearLabels() {
        this.labels.forEach((l) => this.viewer.entities.remove(l));
        this.labels = [];
    }

    _filterDuplicatePositions(positions) {
        if (!positions || positions.length === 0) return [];
        const unique = [];
        for (let i = 0; i < positions.length; i++) {
            const p = positions[i];
            if (p) {
                if (unique.length === 0) {
                    unique.push(p);
                } else {
                    const prev = unique[unique.length - 1];
                    if (Cesium.Cartesian3.distance(prev, p) > 0.001) {
                        unique.push(p);
                    }
                }
            }
        }
        return unique;
    }

    _createLabel(
        position,
        text,
        offset = new Cesium.Cartesian2(0, -10),
        fontColor = Cesium.Color.WHITE,
    ) {
        const label = this.viewer.entities.add({
            position: position,
            label: {
                text: text,
                font: "bold 12px sans-serif",
                fillColor: fontColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: new Cesium.Color(0.04, 0.05, 0.06, 0.85),
                backgroundPadding: new Cesium.Cartesian2(4, 3),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: this.drawer && this.drawer._heightRef,
                pixelOffset: offset,
                scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.0, 1.5e6, 0.5),
            },
        });
        this.labels.push(label);
        return label;
    }

    _updateDrawingGraphics(points, isPolygon, clampToGround) {
        if (points.length < 2) {
            this._removeGraphics();
            return;
        }

        const color = Cesium.Color.fromCssColorString("#f0e40a");

        if (this.isCircle) {
            if (!this.polylineEntity) {
                const polylinePositions = new Cesium.CallbackProperty(() => {
                    return this.points;
                }, false);

                this.polylineEntity = this.viewer.entities.add({
                    name: "Measure Circle Radius Line",
                    polyline: {
                        positions: polylinePositions,
                        width: 2,
                        material: color,
                        clampToGround: clampToGround,
                    },
                });
            }

            if (!this.circleEntity) {
                this.circleEntity = this.viewer.entities.add({
                    name: "Measure Circle Area",
                    position: new Cesium.CallbackProperty(() => this.points[0], false),
                    ellipse: {
                        semiMajorAxis: new Cesium.CallbackProperty(() => {
                            if (this.points.length < 2) return 0.01;
                            return typeof this.calculateRadius === "function"
                                ? this.calculateRadius(this.points[0], this.points[1])
                                : Cesium.Cartesian3.distance(this.points[0], this.points[1]);
                        }, false),
                        semiMinorAxis: new Cesium.CallbackProperty(() => {
                            if (this.points.length < 2) return 0.01;
                            return typeof this.calculateRadius === "function"
                                ? this.calculateRadius(this.points[0], this.points[1])
                                : Cesium.Cartesian3.distance(this.points[0], this.points[1]);
                        }, false),
                        material: color.withAlpha(0.25),
                        outline: true,
                        outlineColor: color,
                        outlineWidth: 2,
                        heightReference: clampToGround
                            ? Cesium.HeightReference.CLAMP_TO_GROUND
                            : Cesium.HeightReference.NONE,
                    },
                });
            }
            return;
        }

        if (!this.polylineEntity) {
            const polylinePositions = new Cesium.CallbackProperty(() => {
                const pts = [...this.points];
                if (isPolygon && pts.length > 2) {
                    pts.push(pts[0]); // Visual loop closure
                }
                return pts;
            }, false);

            this.polylineEntity = this.viewer.entities.add({
                name: "Measure Line",
                polyline: {
                    positions: polylinePositions,
                    width: 2,
                    material: color,
                    clampToGround: clampToGround,
                },
            });
        }

        if (isPolygon && points.length >= 3 && !this.polygonEntity) {
            const polygonHierarchy = new Cesium.CallbackProperty(() => {
                return new Cesium.PolygonHierarchy(this.points);
            }, false);

            this.polygonEntity = this.viewer.entities.add({
                name: "Measure Area",
                polygon: {
                    hierarchy: polygonHierarchy,
                    material: color.withAlpha(0.25),
                    classificationType: clampToGround
                        ? Cesium.ClassificationType.TERRAIN
                        : undefined,
                    perPositionHeight: !clampToGround,
                },
            });
        }
    }

    _removeGraphics() {
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
    }

    updateLabels(points, isDrawing = false) {
        this._updateDrawingGraphics(points, this.isPolygon, this.clampToGround);
        this.clearLabels();

        if (this.isCircle) {
            if (points.length < 2) return;
            const center = points[0];
            const perimeter = points[1];
            const radius = this.calculateRadius(center, perimeter);
            const diameter = radius * 2;
            const area = Math.PI * radius * radius;

            // Start/Center label
            this._createLabel(center, "Center");

            // Label text at the perimeter point
            const formatDist = (d) =>
                d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(2)} m`;
            const formatArea = (a) =>
                a >= 1000000 ? `${(a / 1000000).toFixed(4)} km²` : `${a.toFixed(2)} m²`;

            const text = `Radius: ${formatDist(radius)}\nDiameter: ${formatDist(diameter)}\nArea: ${formatArea(area)}`;
            const color = !isDrawing
                ? Cesium.Color.fromCssColorString("#f0e40a")
                : Cesium.Color.WHITE;
            this._createLabel(perimeter, text, new Cesium.Cartesian2(0, -25), color);
        } else if (this.isPolygon) {
            if (points.length < 3) return;
            const area = this.calculateArea(points, isDrawing);
            const centroid = this._getCentroid(points);

            if (centroid) {
                const text = this.formatAreaText(area);
                const color = !isDrawing
                    ? Cesium.Color.fromCssColorString("#f0e40a")
                    : Cesium.Color.WHITE;
                this._createLabel(centroid, text, new Cesium.Cartesian2(0, 0), color);
            }
        } else {
            if (points.length === 0) return;

            let accumulatedDistance = 0;
            this._createLabel(points[0], "Start");

            for (let i = 1; i < points.length; i++) {
                const p1 = points[i - 1];
                const p2 = points[i];
                const dist = this.calculateDistance(p1, p2);
                accumulatedDistance += dist;

                const text =
                    accumulatedDistance >= 1000
                        ? `+${(dist / 1000).toFixed(2)} km\nTotal: ${(accumulatedDistance / 1000).toFixed(2)} km`
                        : `+${dist.toFixed(2)} m\nTotal: ${accumulatedDistance.toFixed(2)} m`;

                const isLast = i === points.length - 1;
                const color =
                    isLast && !isDrawing
                        ? Cesium.Color.fromCssColorString("#f0e40a")
                        : Cesium.Color.WHITE;
                this._createLabel(p2, text, new Cesium.Cartesian2(0, -25), color);
            }
        }
    }

    _calculatePlanarArea(points) {
        if (points.length < 3) return 0;

        const hasProj4 = typeof proj4 !== "undefined";
        const utmPoints = points.map((p) => {
            const cartographic = Cesium.Cartographic.fromCartesian(p);
            const lng = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);

            if (hasProj4) {
                try {
                    const [x, y] = proj4(WGS84_EPSG, UTM_EPSG, [lng, lat]);
                    return { x, y };
                } catch (e) {
                    const x = lng * 111319.49 * Math.cos(Cesium.Math.toRadians(lat));
                    const y = lat * 111319.49;
                    return { x, y };
                }
            } else {
                const x = lng * 111319.49 * Math.cos(Cesium.Math.toRadians(lat));
                const y = lat * 111319.49;
                return { x, y };
            }
        });

        let area = 0;
        const n = utmPoints.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += utmPoints[i].x * utmPoints[j].y;
            area -= utmPoints[j].x * utmPoints[i].y;
        }
        return Math.abs(area) / 2;
    }

    _getCentroid(points) {
        if (points.length === 0) return null;
        let x = 0,
            y = 0,
            z = 0;
        points.forEach((p) => {
            x += p.x;
            y += p.y;
            z += p.z;
        });
        const n = points.length;
        return new Cesium.Cartesian3(x / n, y / n, z / n);
    }
}

export class DistanceMeasure extends Measure {
    constructor(viewer, options) {
        super(viewer, options);
        this.isPolygon = false;
        this.clampToGround = false;
    }

    calculateDistance(p1, p2) {
        return Cesium.Cartesian3.distance(p1, p2);
    }
}

export class DistanceSurfaceMeasure extends Measure {
    constructor(viewer, options) {
        super(viewer, options);
        this.isPolygon = false;
        this.clampToGround = true;
    }

    calculateDistance(p1, p2) {
        const c1 = Cesium.Cartographic.fromCartesian(p1);
        const c2 = Cesium.Cartographic.fromCartesian(p2);
        const geodesic = new Cesium.EllipsoidGeodesic(c1, c2);
        const pointCount = 15;
        let surfaceDist = 0;
        let lastCartesian = p1;

        for (let j = 1; j <= pointCount; j++) {
            const fraction = j / pointCount;
            const interpolatedCarto = geodesic.interpolateUsingFraction(
                fraction,
                new Cesium.Cartographic(),
            );

            const height =
                this.viewer.scene.globe.getHeight(interpolatedCarto) ??
                interpolatedCarto.height ??
                0;
            const cartesian = Cesium.Cartesian3.fromRadians(
                interpolatedCarto.longitude,
                interpolatedCarto.latitude,
                height,
            );

            surfaceDist += Cesium.Cartesian3.distance(lastCartesian, cartesian);
            lastCartesian = cartesian;
        }
        return surfaceDist;
    }
}

export class AreaMeasure extends Measure {
    constructor(viewer, options) {
        super(viewer, options);
        this.isPolygon = true;
        this.clampToGround = false;
    }

    calculateArea(points, isDrawing) {
        return this._calculatePlanarArea(points);
    }

    formatAreaText(area) {
        return area >= 1000000
            ? `Area: ${(area / 1000000).toFixed(4)} km²`
            : `Area: ${area.toFixed(2)} m²`;
    }
}

export class AreaSurfaceMeasure extends Measure {
    constructor(viewer, options) {
        super(viewer, options);
        this.isPolygon = true;
        this.clampToGround = true;
    }

    calculateArea(points, isDrawing) {
        if (isDrawing) {
            return this._calculatePlanarArea(points);
        }
        return this._calculateSurfaceArea(points);
    }

    formatAreaText(area) {
        return area >= 1000000
            ? `Surface Area: ${(area / 1000000).toFixed(4)} km²`
            : `Surface Area: ${area.toFixed(2)} m²`;
    }

    _calculateSurfaceArea(points) {
        if (points.length < 3) return 0;

        const planarArea = this._calculatePlanarArea(points);
        if (planarArea === 0) return 0;

        const hasProj4 = typeof proj4 !== "undefined";
        if (!hasProj4) return planarArea;

        // Project vertices to UTM
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
        const utmPoints = points.map((p) => {
            const cartographic = Cesium.Cartographic.fromCartesian(p);
            const lng = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            const [x, y] = proj4(WGS84_EPSG, UTM_EPSG, [lng, lat]);
            return { x, y };
        });
        utmPoints.forEach((pt) => {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        });

        const steps = 12;
        const dx = (maxX - minX) / steps;
        const dy = (maxY - minY) / steps;
        let surfaceArea = 0;

        const getCartesianAtUtm = (ux, uy) => {
            const [lng, lat] = proj4(UTM_EPSG, WGS84_EPSG, [ux, uy]);
            const carto = Cesium.Cartographic.fromDegrees(lng, lat);
            const height = this.viewer.scene.globe.getHeight(carto) ?? 0;
            return Cesium.Cartesian3.fromDegrees(lng, lat, height);
        };

        const isInside = (pt) => {
            let inside = false;
            const n = utmPoints.length;
            for (let i = 0, j = n - 1; i < n; j = i++) {
                const xi = utmPoints[i].x,
                    yi = utmPoints[i].y;
                const xj = utmPoints[j].x,
                    yj = utmPoints[j].y;
                const intersect =
                    yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
                if (intersect) inside = !inside;
            }
            return inside;
        };

        const triangleArea3D = (p1, p2, p3) => {
            const v1 = Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3());
            const v2 = Cesium.Cartesian3.subtract(p3, p1, new Cesium.Cartesian3());
            const cross = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3());
            return Cesium.Cartesian3.magnitude(cross) * 0.5;
        };

        for (let i = 0; i < steps; i++) {
            for (let j = 0; j < steps; j++) {
                const x0 = minX + i * dx;
                const x1 = minX + (i + 1) * dx;
                const y0 = minY + j * dy;
                const y1 = minY + (j + 1) * dy;

                // Triangle 1
                const c1 = { x: (x0 + x1 + x0) / 3, y: (y0 + y0 + y1) / 3 };
                if (isInside(c1)) {
                    try {
                        const p1 = getCartesianAtUtm(x0, y0);
                        const p2 = getCartesianAtUtm(x1, y0);
                        const p3 = getCartesianAtUtm(x0, y1);
                        surfaceArea += triangleArea3D(p1, p2, p3);
                    } catch (e) {}
                }

                // Triangle 2
                const c2 = { x: (x1 + x0 + x1) / 3, y: (y1 + y1 + y0) / 3 };
                if (isInside(c2)) {
                    try {
                        const p1 = getCartesianAtUtm(x1, y1);
                        const p2 = getCartesianAtUtm(x0, y1);
                        const p3 = getCartesianAtUtm(x1, y0);
                        surfaceArea += triangleArea3D(p1, p2, p3);
                    } catch (e) {}
                }
            }
        }

        return Math.max(surfaceArea, planarArea);
    }
}

export class CircleMeasure extends Measure {
    constructor(viewer, options) {
        super(viewer, options);
        this.isCircle = true;
        this.isPolygon = false;
        this.clampToGround = true;
    }

    calculateRadius(center, perimeter) {
        const c1 = Cesium.Cartographic.fromCartesian(center);
        const c2 = Cesium.Cartographic.fromCartesian(perimeter);
        const geodesic = new Cesium.EllipsoidGeodesic(c1, c2);
        return geodesic.surfaceDistance;
    }
}
