import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Local storage "disks" (port of Laravel's config/filesystems.php):
 *
 * - local   storage/app/private   in-flight upload chunks (temp_chunks/<session>)
 * - geodata storage/app/geodata   assembled sources, reprojected copies, converted GeoJSON
 * - public  storage/app/public    terrain-tiles/, xyz-tiles/, icons/ (served only through
 *                                 authenticated route handlers, never as static files)
 *
 * docker-compose.tools.yml bind-mounts ./storage/app/geodata, ./storage/app/public/terrain-tiles
 * and ./storage/app/public/xyz-tiles, so these paths are fixed relative to the project root.
 */
// turbopackIgnore: runtime data directory, not something the build should trace or bundle.
export const STORAGE_ROOT = path.resolve(
  /*turbopackIgnore: true*/ process.env.STORAGE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "storage"),
);

export const DISK_ROOTS = {
  local: path.join(STORAGE_ROOT, "app", "private"),
  geodata: path.join(STORAGE_ROOT, "app", "geodata"),
  public: path.join(STORAGE_ROOT, "app", "public"),
} as const;

export type DiskName = keyof typeof DISK_ROOTS;

export class StoragePathError extends Error {}

/**
 * Absolute path of `relativePath` on a disk. Rejects absolute paths and any path that would
 * escape the disk root (".." segments), so callers can pass user-influenced names safely.
 */
export function diskPath(disk: DiskName, relativePath = ""): string {
  const root = DISK_ROOTS[disk];
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
    throw new StoragePathError(`Absolute paths are not allowed on the ${disk} disk.`);
  }
  const resolved = path.resolve(/*turbopackIgnore: true*/ root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new StoragePathError(`Path escapes the ${disk} disk: ${relativePath}`);
  }
  return resolved;
}

/** Storage-relative path with forward slashes (what gets stored in the database). */
export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export const storage = {
  path: diskPath,

  exists(disk: DiskName, relativePath: string): Promise<boolean> {
    return fs
      .access(diskPath(disk, relativePath))
      .then(() => true)
      .catch(() => false);
  },

  existsSync(disk: DiskName, relativePath: string): boolean {
    return existsSync(diskPath(disk, relativePath));
  },

  async read(disk: DiskName, relativePath: string): Promise<Buffer> {
    return fs.readFile(diskPath(disk, relativePath));
  },

  async readText(disk: DiskName, relativePath: string): Promise<string> {
    return fs.readFile(diskPath(disk, relativePath), "utf8");
  },

  readStream(disk: DiskName, relativePath: string) {
    return createReadStream(diskPath(disk, relativePath));
  },

  async write(disk: DiskName, relativePath: string, contents: string | Uint8Array): Promise<void> {
    const target = diskPath(disk, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  },

  async makeDirectory(disk: DiskName, relativePath: string): Promise<string> {
    const target = diskPath(disk, relativePath);
    await fs.mkdir(target, { recursive: true });
    return target;
  },

  async size(disk: DiskName, relativePath: string): Promise<number> {
    return (await fs.stat(diskPath(disk, relativePath))).size;
  },

  /** Deletes a file; missing files are ignored. */
  async delete(disk: DiskName, relativePath: string): Promise<void> {
    await fs.rm(diskPath(disk, relativePath), { force: true });
  },

  /** Deletes a directory recursively; missing directories are ignored. Never deletes a disk root. */
  async deleteDirectory(disk: DiskName, relativePath: string): Promise<void> {
    const target = diskPath(disk, relativePath);
    if (target === DISK_ROOTS[disk]) {
      throw new StoragePathError(`Refusing to delete the root of the ${disk} disk.`);
    }
    await fs.rm(target, { recursive: true, force: true });
  },
};

/** Free bytes on the volume that holds the storage directory. */
export async function freeDiskBytes(): Promise<number> {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  const stats = await fs.statfs(STORAGE_ROOT);
  return Number(stats.bavail) * Number(stats.bsize);
}
