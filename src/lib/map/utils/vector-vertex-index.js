import { Cartesian2, Cartesian3, Cartographic, Rectangle } from "cesium";

const VERTEX_STRIDE = 6;
const CHUNK_VERTICES = 4096;
const LEAF_VERTICES = 32;

/** Static spatial tree in Earth-fixed coordinates, shared by all snap queries for a layer. */
export class VectorVertexIndex {
    constructor() {
        this.length = 0;
        this.chunks = [];
        this.positions = null;
        this.order = null;
        this.root = null;
        this.scratchPosition = new Cartesian3();
    }

    addGeometry(geometry) {
        if (!geometry) return;
        if (geometry.type === "GeometryCollection") {
            geometry.geometries.forEach((part) => this.addGeometry(part));
            return;
        }

        const addCoordinates = (coordinates) => {
            if (!Array.isArray(coordinates) || coordinates.length === 0) return;
            if (Array.isArray(coordinates[0])) {
                coordinates.forEach(addCoordinates);
                return;
            }

            const longitude = Number(coordinates[0]);
            const latitude = Number(coordinates[1]);
            const altitude = Number(coordinates[2] ?? 0);
            if (![longitude, latitude, altitude].every(Number.isFinite)) return;
            if (latitude < -90 || latitude > 90) return;

            const chunkIndex = Math.floor(this.length / CHUNK_VERTICES);
            const offset = (this.length % CHUNK_VERTICES) * VERTEX_STRIDE;
            const chunk = (this.chunks[chunkIndex] ??= new Float64Array(
                CHUNK_VERTICES * VERTEX_STRIDE,
            ));
            const position = Cartesian3.fromDegrees(
                longitude, latitude, altitude, undefined, this.scratchPosition,
            );
            chunk.set([position.x, position.y, position.z, longitude, latitude, altitude], offset);
            this.length++;
        };

        addCoordinates(geometry.coordinates);
    }

    async build() {
        this.positions = new Float64Array(this.length * VERTEX_STRIDE);
        this.chunks.forEach((chunk, index) => {
            const offset = index * CHUNK_VERTICES * VERTEX_STRIDE;
            this.positions.set(chunk.subarray(0, this.positions.length - offset), offset);
        });
        this.chunks = [];
        this.order = Uint32Array.from({ length: this.length }, (_, index) => index);
        if (this.length === 0) return;

        this.root = { start: 0, end: this.length };
        const pending = [this.root];
        let batchStarted = performance.now();
        while (pending.length > 0) {
            const node = pending.pop();
            node.minimum = [Infinity, Infinity, Infinity];
            node.maximum = [-Infinity, -Infinity, -Infinity];
            for (let index = node.start; index < node.end; index++) {
                const offset = this.order[index] * VERTEX_STRIDE;
                for (let axis = 0; axis < 3; axis++) {
                    const value = this.positions[offset + axis];
                    node.minimum[axis] = Math.min(node.minimum[axis], value);
                    node.maximum[axis] = Math.max(node.maximum[axis], value);
                }
            }

            if (node.end - node.start > LEAF_VERTICES) {
                const spans = node.maximum.map((value, axis) => value - node.minimum[axis]);
                const axis = spans.indexOf(Math.max(...spans));
                const midpoint = (node.minimum[axis] + node.maximum[axis]) / 2;
                let split = node.start;
                for (let index = node.start; index < node.end; index++) {
                    if (this.positions[this.order[index] * VERTEX_STRIDE + axis] < midpoint) {
                        const previous = this.order[split];
                        this.order[split++] = this.order[index];
                        this.order[index] = previous;
                    }
                }
                // Coincident vertices remain together; subdivision cannot separate them.
                if (split > node.start && split < node.end) {
                    node.left = { start: node.start, end: split };
                    node.right = { start: split, end: node.end };
                    pending.push(node.left, node.right);
                }
            }

            if (performance.now() - batchStarted > 8) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                batchStarted = performance.now();
            }
        }
    }

    /** Visit only vertices inside the cursor's narrow viewing frustum. */
    query(planes, visit) {
        if (!this.root) return;
        const pending = [this.root];
        while (pending.length > 0) {
            const node = pending.pop();
            const outside = planes.some((plane) => (
                plane.x * (plane.x >= 0 ? node.maximum[0] : node.minimum[0]) +
                plane.y * (plane.y >= 0 ? node.maximum[1] : node.minimum[1]) +
                plane.z * (plane.z >= 0 ? node.maximum[2] : node.minimum[2]) + plane.w < -1e-7
            ));
            if (outside) continue;
            if (node.left) {
                pending.push(node.left, node.right);
                continue;
            }
            for (let index = node.start; index < node.end; index++) {
                const offset = this.order[index] * VERTEX_STRIDE;
                if (planes.every((plane) => (
                    plane.x * this.positions[offset] +
                    plane.y * this.positions[offset + 1] +
                    plane.z * this.positions[offset + 2] + plane.w >= -1e-7
                ))) {
                    visit(this.positions, offset);
                }
            }
        }
    }
}

/** Find the exact closest screen-space candidate without a first-N projection cutoff. */
export function findNearestIndexedVertex(viewer, layers, screenPosition, maxPixelDistance = 15) {
    if (!viewer || !screenPosition || !(maxPixelDistance > 0)) return null;
    const camera = viewer.camera;
    if (camera.positionCartographic.height > 700) return null;

    const { clientWidth: width, clientHeight: height } = viewer.canvas;
    if (!(width > 0 && height > 0)) return null;
    const leftPixel = Math.max(0, screenPosition.x - maxPixelDistance);
    const rightPixel = Math.min(width, screenPosition.x + maxPixelDistance);
    const topPixel = Math.max(0, screenPosition.y - maxPixelDistance);
    const bottomPixel = Math.min(height, screenPosition.y + maxPixelDistance);
    if (leftPixel >= rightPixel || topPixel >= bottomPixel) return null;

    const original = camera.frustum.offCenterFrustum ?? camera.frustum;
    const frustum = original.clone();
    const horizontalSpan = original.right - original.left;
    const verticalSpan = original.top - original.bottom;
    frustum.left = original.left + horizontalSpan * leftPixel / width;
    frustum.right = original.left + horizontalSpan * rightPixel / width;
    frustum.top = original.top - verticalSpan * topPixel / height;
    frustum.bottom = original.top - verticalSpan * bottomPixel / height;
    const { planes } = frustum.computeCullingVolume(
        camera.positionWC, camera.directionWC, camera.upWC,
    );
    const viewRectangle = camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    const cartographic = new Cartographic();
    const position = new Cartesian3();
    const screen = new Cartesian2();
    let nearest = null;
    let nearestDistance = maxPixelDistance;

    for (const layer of layers) {
        const collections = layer.collections || [];
        if (collections.length === 0 || collections[0].show === false || !layer.vertexIndex) {
            continue;
        }
        layer.vertexIndex.query(planes, (positions, offset) => {
            const longitude = positions[offset + 3];
            const latitude = positions[offset + 4];
            const altitude = positions[offset + 5];
            Cartographic.fromDegrees(longitude, latitude, altitude, cartographic);
            if (viewRectangle && !Rectangle.contains(viewRectangle, cartographic)) return;
            Cartesian3.fromElements(positions[offset], positions[offset + 1], positions[offset + 2], position);
            const projected = viewer.scene.cartesianToCanvasCoordinates(position, screen);
            if (!projected) return;
            const distance = Cartesian2.distance(screenPosition, projected);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = {
                    cartesian: Cartesian3.clone(position),
                    longitude,
                    latitude,
                    altitude: altitude !== 0 ? altitude : null,
                };
            }
        });
    }

    return nearest;
}
