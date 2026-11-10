export const DEFAULT_MAP_QUALITY = 2;

export function normalizeMapQuality(value) {
    const quality = Number(value);
    return Number.isFinite(quality) && quality >= 2 && quality <= 16
        ? Math.round(quality / 2) * 2
        : DEFAULT_MAP_QUALITY;
}

/** Keeps display budgets separate from the full-resolution terrain used by analysis. */
export class MapPerformanceController {
    constructor(viewer, {
        quality,
        device = navigator,
        viewport = window,
    } = {}) {
        this.viewer = viewer;
        this.viewport = viewport;
        this.constrained = device.deviceMemory <= 4 || device.hardwareConcurrency <= 4
            || device.connection?.saveData === true;
        this.quality = normalizeMapQuality(quality);

        viewer.useBrowserRecommendedResolution = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.renderable = false;
        viewer.scene.globe.tileCacheSize = this.constrained ? 64 : 100;

        this.onResize = () => this.apply();
        viewport.addEventListener("resize", this.onResize);
        if (viewport.ResizeObserver) {
            this.resizeObserver = new viewport.ResizeObserver(this.onResize);
            this.resizeObserver.observe(viewer.canvas);
        }
        this.apply();
    }

    setQuality(value) {
        this.quality = normalizeMapQuality(value);
        this.apply();
        return this.quality;
    }

    apply() {
        const viewer = this.viewer;
        const economy = this.constrained || this.quality > 8;
        const pixelBudget = economy ? 1_000_000 : 2_073_600;
        const pixels = Math.max(1, viewer.canvas.clientWidth * viewer.canvas.clientHeight);
        viewer.resolutionScale = this.quality <= 2 ? 1 : Math.min(1, Math.sqrt(pixelBudget / pixels));
        viewer.targetFrameRate = economy ? 30 : 60;
        viewer.scene.globe.maximumScreenSpaceError = this.quality;
        viewer.scene.requestRender();
    }

    destroy() {
        this.resizeObserver?.disconnect();
        this.viewport.removeEventListener("resize", this.onResize);
    }
}
