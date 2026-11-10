import fs from "node:fs/promises";

import { isNumericString, phpFloat, phpInt } from "@/server/services/support";

/**
 * Surpac .str string files to GeoJSON in the source CRS (port of SurpacStrParserService). Records
 * are `string id, northing, easting, elevation[, description]`, comma or whitespace delimited;
 * a record with string number 0 (segment terminator or axis record) ends a segment. One-vertex segments become Points, others LineStrings,
 * with coordinates in [easting, northing, elevation] order.
 */
export type StrPosition = [number, number, number];
export type StrFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: StrPosition } | { type: "LineString"; coordinates: StrPosition[] };
  properties: Record<string, never>;
};
export type StrFeatureCollection = { type: "FeatureCollection"; features: StrFeature[] };

/** fgets($handle, 65537) reads at most 65536 bytes of a line. */
const MAX_LINE_BYTES = 65536;
const MAX_SEGMENT_VERTICES = 100_000;
const BLOCK_SIZE = 65536;

function createFeature(points: StrPosition[]): StrFeature {
  if (points.length === 1) {
    return { type: "Feature", geometry: { type: "Point", coordinates: points[0] }, properties: {} };
  }
  return { type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: {} };
}

/** Lines of a file (without "\n"), refusing lines longer than the fgets() limit. */
async function* readLines(filePath: string): AsyncGenerator<string> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch {
    throw new Error(`Could not open file: ${filePath}`);
  }
  try {
    const block = Buffer.alloc(BLOCK_SIZE);
    let pending: Buffer[] = [];
    let pendingLength = 0;
    for (;;) {
      const { bytesRead } = await handle.read(block, 0, BLOCK_SIZE, null);
      if (bytesRead === 0) break;
      let start = 0;
      for (let i = 0; i < bytesRead; i++) {
        if (block[i] !== 0x0a) continue;
        const lineLength = pendingLength + (i - start);
        if (lineLength >= MAX_LINE_BYTES) throw new Error("STR line exceeds the processing limit.");
        pending.push(block.subarray(start, i));
        yield Buffer.concat(pending).toString("latin1");
        pending = [];
        pendingLength = 0;
        start = i + 1;
      }
      if (start < bytesRead) {
        pending.push(Buffer.from(block.subarray(start, bytesRead)));
        pendingLength += bytesRead - start;
        if (pendingLength > MAX_LINE_BYTES) throw new Error("STR line exceeds the processing limit.");
      }
    }
    if (pendingLength > 0) yield Buffer.concat(pending).toString("latin1");
  } finally {
    await handle.close();
  }
}

/** PHP trim(): " \t\n\r\0\x0B" */
function phpTrim(value: string): string {
  return value.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, "");
}

export async function* parseStrFeatures(filePath: string): AsyncGenerator<StrFeature> {
  let segment: StrPosition[] = [];

  for await (const rawLine of readLines(filePath)) {
    const line = phpTrim(rawLine);
    // PHP empty(): "" and "0" are both skipped.
    if (line === "" || line === "0") continue;

    // Comma-delimited first, whitespace-delimited otherwise.
    let parts = line.split(",");
    if (parts.length < 4) parts = line.split(/[ \t\n\r\v\f]+/);
    parts = parts.map(phpTrim);

    // Header, axis and description lines.
    if (parts.length < 4 || !isNumericString(parts[0])) continue;

    const stringId = phpInt(parts[0]);
    const y = phpFloat(parts[1]); // northing
    const x = phpFloat(parts[2]); // easting
    const z = phpFloat(parts[3]); // elevation

    // String number 0 is never data: `0, 0, 0, 0` ends a segment, and the axis record (line 2)
    // also uses 0 — with real coordinates, which must not become a vertex.
    if (stringId === 0) {
      if (segment.length > 0) {
        yield createFeature(segment);
        segment = [];
      }
      continue;
    }

    segment.push([x, y, z]);
    if (segment.length > MAX_SEGMENT_VERTICES) {
      throw new Error("STR segment exceeds the 100,000 vertex limit.");
    }
  }

  if (segment.length > 0) yield createFeature(segment);
}

export async function parseStrFile(filePath: string): Promise<StrFeatureCollection> {
  const features: StrFeature[] = [];
  for await (const feature of parseStrFeatures(filePath)) features.push(feature);
  return { type: "FeatureCollection", features };
}

/** Streams the parsed features into a GeoJSON FeatureCollection file. */
export async function writeStrGeoJson(filePath: string, outputPath: string): Promise<void> {
  let output: fs.FileHandle;
  try {
    output = await fs.open(outputPath, "w");
  } catch {
    throw new Error("Unable to create STR output.");
  }
  try {
    let buffer = '{"type":"FeatureCollection","features":[';
    let first = true;
    for await (const feature of parseStrFeatures(filePath)) {
      buffer += (first ? "" : ",") + JSON.stringify(feature);
      first = false;
      if (buffer.length >= 1024 * 1024) {
        await write(output, buffer);
        buffer = "";
      }
    }
    buffer += "]}";
    await write(output, buffer);
  } finally {
    await output.close();
  }
}

async function write(output: fs.FileHandle, data: string): Promise<void> {
  const bytes = Buffer.from(data, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await output.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error("Unable to write STR output.");
    offset += bytesWritten;
  }
}
