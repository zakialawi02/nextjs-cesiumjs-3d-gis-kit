/** Shares provider metadata between the map and analysis, retaining only recent terrains. */
export class TerrainProviderCache {
    constructor(loadProvider, limit = 3) {
        this.loadProvider = loadProvider;
        this.limit = limit;
        this.providers = new Map();
    }

    async get(url) {
        const key = url.replace(/\/layer\.json\/?$/, "").replace(/\/$/, "");
        let pending = this.providers.get(key);
        if (pending) {
            this.providers.delete(key);
        } else {
            pending = Promise.resolve().then(() => this.loadProvider(key));
        }
        this.providers.set(key, pending);
        while (this.providers.size > this.limit) {
            this.providers.delete(this.providers.keys().next().value);
        }

        try {
            return await pending;
        } catch (error) {
            if (this.providers.get(key) === pending) {
                this.providers.delete(key);
            }
            throw error;
        }
    }

    clear() {
        this.providers.clear();
    }
}
