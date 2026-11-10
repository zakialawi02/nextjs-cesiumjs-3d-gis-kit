import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/geodata", () => ({
  geodataConfig: {
    upload: { zipMaxEntries: 10, zipMaxUncompressedMb: 1, zipMaxRatio: 100, minFreeDiskMb: 0 },
  },
}));

import { extractShapefileArchive } from "@/server/services/upload/shapefile-archive";

import { temporaryFileWith, temporaryPath } from "./helpers";
import { buildZip, SHAPEFILE_PARTS, type ZipEntryInput } from "./zip-builder";

function shapefileEntries(overrides: ZipEntryInput[] = []): ZipEntryInput[] {
  return [...SHAPEFILE_PARTS.map((name) => ({ name, data: `content of ${name}`, deflate: true })), ...overrides];
}

function extract(entries: ZipEntryInput[]) {
  const zipPath = temporaryFileWith(buildZip(entries), ".zip");
  return extractShapefileArchive(zipPath, temporaryPath());
}

describe("ShapefileArchive", () => {
  it("extracts a complete shapefile dataset and returns the .shp path", async () => {
    const shpPath = await extract(shapefileEntries([{ name: "roads.cpg", data: "UTF-8" }]));

    expect(path.basename(shpPath)).toBe("roads.shp");
    expect(readFileSync(shpPath, "utf8")).toBe("content of roads.shp");
    expect(readFileSync(path.join(path.dirname(shpPath), "roads.cpg"), "utf8")).toBe("UTF-8");
  });

  it("keeps sub directories inside the destination", async () => {
    const shpPath = await extract(SHAPEFILE_PARTS.map((name) => ({ name: `data/${name}`, data: name })));

    expect(shpPath.split(path.sep).slice(-2)).toEqual(["data", "roads.shp"]);
  });

  it.each([
    ["parent traversal", "../roads.xml", "Unsafe archive entry path."],
    ["absolute path", "/etc/roads.xml", "Unsafe archive entry path."],
    ["drive letter", "C:/roads.xml", "Unsafe archive entry path."],
    ["backslash traversal", "..\\roads.xml", "Unsafe archive entry path."],
    ["reserved device name", "CON.xml", "Unsafe archive entry name."],
    ["trailing dot", "dir./roads.xml", "Unsafe archive entry name."],
    ["unsupported type", "readme.txt", "Archive contains an unsupported file type."],
    ["duplicate entry", "ROADS.SHP", "Duplicate archive entry."],
  ])("rejects %s", async (_label, name, message) => {
    await expect(extract(shapefileEntries([{ name, data: "x" }]))).rejects.toThrow(message);
  });

  it("rejects symbolic links", async () => {
    await expect(
      extract(shapefileEntries([{ name: "link.xml", data: "roads.shp", versionMadeBy: (3 << 8) | 20, externalAttributes: 0o120777 << 16 }])),
    ).rejects.toThrow("Archive links and special files are not allowed.");
  });

  it("rejects encrypted entries", async () => {
    await expect(extract(shapefileEntries([{ name: "roads.xml", data: "x", flags: 1, deflate: true }]))).rejects.toThrow(
      "Encrypted archive entries are not supported.",
    );
  });

  it("requires exactly one dataset with its SHX, DBF and PRJ", async () => {
    await expect(extract(shapefileEntries([{ name: "rivers.shp", data: "x" }]))).rejects.toThrow(
      "Provide exactly one shapefile dataset per archive.",
    );
    await expect(extract(SHAPEFILE_PARTS.filter((name) => !name.endsWith(".prj")).map((name) => ({ name, data: "x" })))).rejects.toThrow(
      "Shapefile archive requires matching SHP, SHX, DBF and PRJ files.",
    );
  });

  it("enforces entry count, size and compression ratio limits", async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `part${i}.xml`, data: "x" }));
    await expect(extract(many)).rejects.toThrow("Archive contains too many entries or is empty.");

    await expect(extract(shapefileEntries([{ name: "roads.qix", data: Buffer.alloc(512 * 1024, 1), deflate: true }]))).rejects.toThrow(
      "Archive exceeds decompression limits.",
    );
    await expect(extract(shapefileEntries([{ name: "roads.sbn", data: Buffer.alloc(2 * 1024 * 1024) }]))).rejects.toThrow(
      "Archive exceeds decompression limits.",
    );
  });

  it("verifies the CRC of extracted entries", async () => {
    await expect(extract(shapefileEntries([{ name: "roads.xml", data: "payload", crc: 12345 }]))).rejects.toThrow(
      "Archive entry failed integrity verification.",
    );
  });

  it("rejects files that are not archives", async () => {
    await expect(extractShapefileArchive(temporaryFileWith("not a zip", ".zip"), temporaryPath())).rejects.toThrow(
      "Unable to open shapefile archive.",
    );
  });
});
