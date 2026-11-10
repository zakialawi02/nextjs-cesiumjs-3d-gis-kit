import { LayerStatus } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { abortUnless } from "@/server/http";

/**
 * "Is this layer published?" for the tile endpoints (terrain and orthophoto). Tiles stay on disk
 * until the cleanup job runs, so only layers that still exist and are published are served. A map
 * view requests hundreds of tiles, so the answer is cached in memory for 30 seconds (Laravel:
 * Cache::remember("layer-published:{id}", 30, ...)).
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 2_000;

type Entry = { value: boolean; expiresAt: number };

const globalCache = globalThis as typeof globalThis & {
  publishedLayerCache?: Map<string, Entry>;
  publishedLayerLookups?: Map<string, Promise<boolean>>;
};
const cache = (globalCache.publishedLayerCache ??= new Map());
const lookups = (globalCache.publishedLayerLookups ??= new Map());

export async function isLayerPublished(layerId: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(layerId);
  if (cached && cached.expiresAt > now) return cached.value;

  // Concurrent tile requests for the same layer share one query.
  let lookup = lookups.get(layerId);
  if (!lookup) {
    lookup = prisma.layer
      .findFirst({ where: { id: layerId, status: LayerStatus.Published }, select: { id: true } })
      .then((layer) => {
        const value = layer !== null;
        if (cache.size >= MAX_ENTRIES) {
          for (const [key, entry] of cache) {
            if (entry.expiresAt <= Date.now()) cache.delete(key);
          }
          if (cache.size >= MAX_ENTRIES) cache.clear();
        }
        cache.set(layerId, { value, expiresAt: Date.now() + TTL_MS });
        return value;
      })
      .finally(() => lookups.delete(layerId));
    lookups.set(layerId, lookup);
  }
  return lookup;
}

/** 404 unless the layer exists and is published. */
export async function abortUnlessPublished(layerId: string): Promise<void> {
  abortUnless(await isLayerPublished(layerId), 404);
}

/** Missing files (or directories where a file was expected) are a plain 404, not a 500. */
export function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
