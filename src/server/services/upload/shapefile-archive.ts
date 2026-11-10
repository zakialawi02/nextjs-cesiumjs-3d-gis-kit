import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { crc32 } from "node:zlib";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import { geodataConfig } from "@/config/geodata";
import { ensureDiskSpace } from "@/server/services/upload/upload-session-service";

/**
 * Safe extraction of a zipped shapefile (port of ShapefileArchive): entry count, total size and
 * compression ratio limits, no links / special files / encrypted entries / unsafe names, only
 * shapefile sidecar extensions, exactly one dataset with SHP + SHX + DBF + PRJ, and a CRC check
 * of every extracted entry. Returns the path of the extracted .shp file.
 */
// "qmd" is the QGIS layer-metadata sidecar (XML, never parsed by GDAL) that QGIS adds to exported
// shapefiles; like ".shp.xml" it is accepted so QGIS zips upload without repacking.
const ALLOWED_EXTENSIONS = ["shp", "shx", "dbf", "prj", "cpg", "sbn", "sbx", "qix", "xml", "qmd"];

type ArchiveEntry = { entry: Entry; name: string; size: number; crc: number };

/** yauzl's file name decoder (CP437 / UTF-8 / Info-ZIP unicode path), exported but untyped. */
const getFileNameLowLevel = (
  yauzl as unknown as {
    getFileNameLowLevel(flags: number, raw: Buffer, extraFields: Entry["extraFields"], strict: boolean): string;
  }
).getFileNameLowLevel;

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true }, (error, zipfile) => {
      if (error || !zipfile) reject(error ?? new Error("Unable to open archive."));
      else resolve(zipfile);
    });
  });
}

function readEntries(zipfile: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zipfile.on("entry", (entry: Entry) => {
      entries.push(entry);
      zipfile.readEntry();
    });
    zipfile.once("end", () => resolve(entries));
    zipfile.once("error", reject);
    zipfile.readEntry();
  });
}

function openEntryStream(zipfile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("Unable to extract archive entry."));
      else resolve(stream);
    });
  });
}

function entryName(entry: Entry): string {
  const raw = entry.fileName as unknown;
  if (typeof raw === "string") return raw;
  return getFileNameLowLevel(entry.generalPurposeBitFlag, raw as Buffer, entry.extraFields, true);
}

function assertSafeName(name: string): void {
  const segments = name.split("/");
  if (
    name === "" ||
    name.startsWith("/") ||
    /[\x00-\x1f\x7f:<>"|?*]/.test(name) ||
    segments.includes("..") ||
    segments.includes(".")
  ) {
    throw new Error("Unsafe archive entry path.");
  }
  for (const segment of name.replace(/\/+$/, "").split("/")) {
    if (segment === "" || segment.replace(/[ .]+$/, "") !== segment || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)) {
      throw new Error("Unsafe archive entry name.");
    }
  }
}

export async function extractShapefileArchive(zipPath: string, destination: string): Promise<string> {
  let zipfile: ZipFile;
  try {
    zipfile = await openZip(zipPath);
  } catch {
    throw new Error("Unable to open shapefile archive.");
  }

  try {
    const maximum = geodataConfig.upload.zipMaxUncompressedMb * 1024 * 1024;
    if (zipfile.entryCount < 1 || zipfile.entryCount > geodataConfig.upload.zipMaxEntries) {
      throw new Error("Archive contains too many entries or is empty.");
    }

    let rawEntries: Entry[];
    try {
      rawEntries = await readEntries(zipfile);
    } catch {
      throw new Error("Unable to inspect archive entry.");
    }

    const entries: ArchiveEntry[] = [];
    const seen = new Set<string>();
    const shapefiles: string[] = [];
    let total = 0;

    for (const entry of rawEntries) {
      const name = entryName(entry).replace(/\\/g, "/");
      assertSafeName(name);

      const operatingSystem = (entry.versionMadeBy >> 8) & 0xff;
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (operatingSystem === 3 && ![0, 0o100000, 0o040000].includes(type)) {
        throw new Error("Archive links and special files are not allowed.");
      }
      if (entry.isEncrypted()) {
        throw new Error("Encrypted archive entries are not supported.");
      }
      if (name.endsWith("/")) continue;

      const dot = name.lastIndexOf(".");
      const slash = name.lastIndexOf("/");
      const extension = dot > slash ? name.slice(dot + 1).toLowerCase() : "";
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        throw new Error("Archive contains an unsupported file type.");
      }
      const key = name.toLowerCase();
      if (seen.has(key)) throw new Error("Duplicate archive entry.");
      seen.add(key);

      total += entry.uncompressedSize;
      if (total > maximum || entry.uncompressedSize > Math.max(1, entry.compressedSize) * geodataConfig.upload.zipMaxRatio) {
        throw new Error("Archive exceeds decompression limits.");
      }
      entries.push({ entry, name, size: entry.uncompressedSize, crc: entry.crc32 >>> 0 });
      if (extension === "shp") shapefiles.push(name);
    }

    if (shapefiles.length !== 1) {
      throw new Error("Provide exactly one shapefile dataset per archive.");
    }
    const base = shapefiles[0].slice(0, -4).toLowerCase();
    for (const extension of ["shx", "dbf", "prj"]) {
      if (!seen.has(`${base}.${extension}`)) {
        throw new Error("Shapefile archive requires matching SHP, SHX, DBF and PRJ files.");
      }
    }

    await ensureDiskSpace(total);
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });

    let writtenTotal = 0;
    for (const { entry, name, size, crc } of entries) {
      const outputPath = path.join(destination, ...name.split("/"));
      await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });

      let input: Readable;
      let output: fs.FileHandle;
      try {
        input = await openEntryStream(zipfile, entry);
      } catch {
        throw new Error("Unable to extract archive entry.");
      }
      try {
        output = await fs.open(outputPath, "wx");
      } catch {
        input.destroy();
        throw new Error("Unable to extract archive entry.");
      }

      let written = 0;
      let checksum = 0;
      try {
        const reader = (input as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
        for (;;) {
          let next: IteratorResult<Buffer>;
          try {
            next = await reader.next();
          } catch (error) {
            if (error instanceof Error && /too many bytes/i.test(error.message)) {
              throw new Error("Archive exceeds decompression limits.");
            }
            throw new Error("Unable to decompress archive entry.");
          }
          if (next.done) break;
          const buffer = next.value;
          written += buffer.length;
          writtenTotal += buffer.length;
          if (written > size || writtenTotal > maximum) {
            throw new Error("Archive exceeds decompression limits.");
          }
          const { bytesWritten } = await output.write(buffer, 0, buffer.length);
          if (bytesWritten !== buffer.length) throw new Error("Unable to write extracted file.");
          checksum = crc32(buffer, checksum);
        }
      } finally {
        input.destroy();
        await output.close();
      }

      if (written !== size || checksum >>> 0 !== crc) {
        throw new Error("Archive entry failed integrity verification.");
      }
    }

    return path.join(destination, ...shapefiles[0].split("/"));
  } finally {
    zipfile.close();
  }
}
