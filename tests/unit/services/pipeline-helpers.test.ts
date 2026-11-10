import type { UploadSession } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/geodata", () => ({
  geodataConfig: {
    allowedExtensions: ["tif", "tiff", "geotiff", "geojson", "dxf", "dwg", "str", "zip"],
    dockerComposeBin: "docker compose",
    dockerComposeFile: "docker-compose.tools.yml",
  },
}));

import { HttpError } from "@/server/http";
import { dockerComposeCommand, dockerComposeRunArgs } from "@/server/services/conversion/docker";
import { calculateBoundingBox } from "@/server/services/conversion/terrain-conversion-service";
import {
  columnNameForProperty,
  generateTableName,
  isValidVectorTableName,
  qualifiedVectorTable,
} from "@/server/services/database/dynamic-table-service";
import { parsePostGisExtent } from "@/server/services/database/spatial-import-service";
import { isConversionRunning, STALE_JOB_SECONDS } from "@/server/services/layers/layer-deletion-service";
import {
  fileExtension,
  isNumericString,
  isUlid,
  isUuid,
  phpFloat,
  phpInt,
  randomString,
  toIso8601String,
  ulid,
} from "@/server/services/support";
import { completionHash } from "@/server/services/upload/upload-completion-service";
import { chunkMap, presentUploadSession, validateFileName } from "@/server/services/upload/upload-session-service";

describe("support helpers", () => {
  it("generates uppercase, time-ordered ULIDs that pass Str::isUlid", () => {
    const first = ulid(1_700_000_000_000);
    const second = ulid(1_700_000_000_001);
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isUlid(first)).toBe(true);
    expect(first.slice(0, 10) < second.slice(0, 10)).toBe(true);
    expect(isUlid("not-a-ulid")).toBe(false);
    expect(isUlid("81J000000000000000000000000".slice(0, 26))).toBe(false);
  });

  it("checks uuids and random strings", () => {
    expect(isUuid("6f1c1d36-3b0e-4b7e-9d2a-0c8f2b6c1a11")).toBe(true);
    expect(isUuid("6f1c1d36")).toBe(false);
    expect(randomString(8)).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it("mirrors PHP numeric parsing", () => {
    expect(isNumericString(" 5")).toBe(true);
    expect(isNumericString("1e3")).toBe(true);
    expect(isNumericString("pit")).toBe(false);
    expect(isNumericString("")).toBe(false);
    expect(phpInt("1.9")).toBe(1);
    expect(phpInt("-7")).toBe(-7);
    expect(phpInt("12abc")).toBe(12);
    expect(phpInt("abc")).toBe(0);
    expect(phpFloat("100.5abc")).toBe(100.5);
    expect(phpFloat("abc")).toBe(0);
  });

  it("extracts extensions like pathinfo()", () => {
    expect(fileExtension("dem.TIF")).toBe("TIF");
    expect(fileExtension("archive.tar.zip")).toBe("zip");
    expect(fileExtension("noext")).toBe("");
    expect(fileExtension("dir.v1/file")).toBe("");
  });

  it("formats timestamps like Carbon::toIso8601String()", () => {
    expect(toIso8601String(new Date("2026-11-09T16:17:05.123Z"))).toBe("2026-11-09T16:17:05+00:00");
    expect(toIso8601String(null)).toBeNull();
  });
});

describe("vector tables", () => {
  it("derives validated table and column names", () => {
    expect(generateTableName("01JCDE5QW8Z9X2Y3V4T5S6R7P8")).toBe("vector_01jcde5qw8z9x2y3v4t5s6r7p8");
    expect(isValidVectorTableName("vector_01jcde5qw8z9x2y3v4t5s6r7p8")).toBe(true);
    expect(isValidVectorTableName('vector_x"; DROP TABLE users; --')).toBe(false);
    expect(qualifiedVectorTable("vector_abc")).toBe('geodata_vectors."vector_abc"');
    expect(() => qualifiedVectorTable("users")).toThrow("Invalid table name: users");
    expect(columnNameForProperty("Road Name")).toBe("road_name");
    expect(columnNameForProperty("ID")).toBe("attr_id");
    expect(columnNameForProperty("geometry")).toBe("attr_geometry");
  });

  it("parses ST_Extent output", () => {
    expect(parsePostGisExtent("POLYGON((106.1 -6.5,106.1 -6.1,106.9 -6.1,106.9 -6.5,106.1 -6.5))")).toEqual({
      west: 106.1,
      south: -6.5,
      east: 106.9,
      north: -6.1,
    });
    expect(parsePostGisExtent("LINESTRING(1 2,3 2)")).toEqual({ west: 1, south: 2, east: 3, north: 2 });
    expect(parsePostGisExtent("POINT(1 2)")).toBeNull();
    expect(parsePostGisExtent(null)).toBeNull();
  });
});

describe("terrain metadata", () => {
  it("computes the bounding box from gdalinfo corner coordinates", () => {
    expect(
      calculateBoundingBox({
        upperLeft: [106.0, -6.0],
        lowerLeft: [106.1, -6.5],
        upperRight: [107.0, -5.9],
        lowerRight: [106.9, -6.6],
      }),
    ).toEqual({ west: 106.0, south: -6.6, east: 107.0, north: -5.9 });
  });
});

describe("docker compose commands", () => {
  it("builds the docker compose run arguments like the PHP services", () => {
    expect(dockerComposeCommand()).toEqual({ command: "docker", args: ["compose"] });
    expect(
      dockerComposeRunArgs("gdal", ["gdalinfo", "/data/geodata/geotiff/a.tif"], {
        jobId: "01JOB",
        runOptions: ["-v", "/in:/data/input:ro"],
      }),
    ).toEqual([
      "compose", "-f", "docker-compose.tools.yml", "run", "--rm",
      "-v", "/in:/data/input:ro",
      "-l", "conversion_job_id=01JOB",
      "gdal", "gdalinfo", "/data/geodata/geotiff/a.tif",
    ]);
    expect(dockerComposeRunArgs("ctb", ["ctb-tile", "--version"])).toEqual([
      "compose", "-f", "docker-compose.tools.yml", "run", "--rm", "ctb", "ctb-tile", "--version",
    ]);
  });
});

describe("upload sessions", () => {
  it("validates file names", () => {
    expect(() => validateFileName("dem.tif")).not.toThrow();
    for (const name of ["dem.exe", "../dem.tif", "a:b.tif", `${"x".repeat(252)}.tif`, "noext"]) {
      expect(() => validateFileName(name)).toThrow(HttpError);
    }
  });

  it("reads chunk maps stored as objects or lists", () => {
    expect(chunkMap({ "0": "a", "2": "c", x: "ignored" })).toEqual({ "0": "a", "2": "c" });
    expect(chunkMap(["a", "b"])).toEqual({ "0": "a", "1": "b" });
    expect(chunkMap(null)).toEqual({});
  });

  it("presents a session in the shape the browser client expects", () => {
    const session = {
      id: "6f1c1d36-3b0e-4b7e-9d2a-0c8f2b6c1a11",
      file_name: "dem.tif",
      file_size: BigInt(5_000_000),
      chunk_size: 2_097_152,
      total_chunks: 3,
      chunks: { "0": "abc" },
      status: "uploading",
      conversion_job_id: null,
      expires_at: new Date("2026-11-10T00:00:00Z"),
    } as unknown as UploadSession;

    expect(presentUploadSession(session)).toEqual({
      identifier: session.id,
      fileName: "dem.tif",
      fileSize: 5_000_000,
      chunkSize: 2_097_152,
      totalChunks: 3,
      chunks: { "0": "abc" },
      status: "uploading",
      job_id: null,
      expiresAt: "2026-11-10T00:00:00+00:00",
    });
  });

  it("hashes only the normalized completion parameters", () => {
    const base = { layerName: "Pit", demIdentifier: "a", orthoIdentifier: null };
    expect(completionHash(base, "terrain")).toBe(completionHash({ ...base, sourceEpsg: null }, "terrain"));
    expect(completionHash(base, "terrain")).not.toBe(completionHash({ ...base, layerName: "Pit 2" }, "terrain"));
    expect(completionHash(base, "terrain")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("layer deletion", () => {
  it("treats queued / processing jobs as running until they are stale", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const recent = new Date(now.getTime() - 60_000);
    const stale = new Date(now.getTime() - (STALE_JOB_SECONDS + 1) * 1000);

    expect(isConversionRunning(null, now)).toBe(false);
    expect(isConversionRunning({ status: "done", updated_at: recent }, now)).toBe(false);
    expect(isConversionRunning({ status: "failed", updated_at: recent }, now)).toBe(false);
    expect(isConversionRunning({ status: "queued", updated_at: recent }, now)).toBe(true);
    expect(isConversionRunning({ status: "processing", updated_at: recent }, now)).toBe(true);
    expect(isConversionRunning({ status: "processing", updated_at: stale }, now)).toBe(false);
  });
});
