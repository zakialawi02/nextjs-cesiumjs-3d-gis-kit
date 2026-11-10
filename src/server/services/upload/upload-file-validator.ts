import fs from "node:fs/promises";

import { readGeoJsonFeatures } from "@/server/services/upload/geojson-feature-reader";

/**
 * Checks that an assembled upload really is the format its extension claims (port of
 * UploadFileValidator): magic bytes for binary formats, a content pattern for DXF / STR, and a
 * full streaming parse for GeoJSON.
 */
const HEADER_BYTES = 65536;

// PCRE \s without the /u flag.
const S = "[\\t\\n\\v\\f\\r ]";
// ASCII DXF must START with a group code 0 / "SECTION" pair (optionally after a BOM, whitespace and
// 999 comment groups). Searching anywhere in the header let other formats through as "DXF".
// The header is decoded byte-per-char, so a UTF-8 BOM appears as "ï»¿".
const DXF_SECTION = new RegExp(
  `^(?:\\u00EF\\u00BB\\u00BF|\\uFEFF)?${S}*(?:999[ \\t]*\\r?\\n[^\\n]*\\n${S}*)*0[ \\t]*\\r?\\nSECTION\\b`,
  "i",
);
// /^\s*\d+\s*[,\s]\s*-?[\d.]+\s*[,\s]\s*-?[\d.]+\s*[,\s]\s*-?[\d.]+/m — ^ only after "\n", as in PCRE.
const STR_RECORD = new RegExp(
  `(?:^|(?<=\\n))${S}*\\d+${S}*[,\\t\\n\\v\\f\\r ]${S}*-?[\\d.]+${S}*[,\\t\\n\\v\\f\\r ]${S}*-?[\\d.]+${S}*[,\\t\\n\\v\\f\\r ]${S}*-?[\\d.]+`,
);

const TIFF_SIGNATURES = ["II\x2a\x00", "MM\x00\x2a", "II\x2b\x00", "MM\x00\x2b"];
const BINARY_DXF_SIGNATURE = "AutoCAD Binary DXF\r\n\x1a\x00";

async function readHeader(filePath: string): Promise<Buffer> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch {
    throw new Error("Unable to inspect uploaded file.");
  }
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Whether the first bytes match the format of `extension` (GeoJSON is checked separately). */
export function headerMatchesFormat(header: Buffer, extension: string): boolean {
  // latin1 maps every byte to one char, like PHP's binary strings.
  const text = header.toString("latin1");
  switch (extension) {
    case "tif":
    case "tiff":
    case "geotiff":
      return TIFF_SIGNATURES.includes(text.slice(0, 4));
    case "zip":
      return text.startsWith("PK\x03\x04");
    case "dwg":
      return /^AC10[0-9]{2}/.test(text);
    case "dxf":
      return text.startsWith(BINARY_DXF_SIGNATURE) || DXF_SECTION.test(text);
    case "str":
      return !text.includes("\x00") && STR_RECORD.test(text);
    case "geojson":
      return true;
    default:
      return false;
  }
}

export async function validateUploadedFile(filePath: string, extension: string): Promise<void> {
  const normalized = extension.toLowerCase();
  const header = await readHeader(filePath);
  if (header.length === 0) {
    throw new Error("Uploaded file is empty.");
  }
  if (!headerMatchesFormat(header, normalized)) {
    throw new Error("File content does not match the supported format.");
  }
  if (normalized === "geojson") {
    // Exhaust the streaming parser to validate the complete document.
    for await (const feature of readGeoJsonFeatures(filePath)) {
      void feature;
    }
  }
}

/** finfo-like MIME type of an assembled upload, from its signature. */
export async function detectMimeType(filePath: string, extension: string): Promise<string> {
  let header: Buffer;
  try {
    header = await readHeader(filePath);
  } catch {
    return "application/octet-stream";
  }
  const text = header.toString("latin1");
  if (TIFF_SIGNATURES.includes(text.slice(0, 4))) return "image/tiff";
  if (text.startsWith("PK\x03\x04")) return "application/zip";
  if (/^AC10[0-9]{2}/.test(text)) return "image/vnd.dwg";
  if (text.startsWith(BINARY_DXF_SIGNATURE)) return "image/vnd.dxf";
  if (text.includes("\x00")) return "application/octet-stream";
  const trimmed = text.trimStart();
  if (extension.toLowerCase() === "geojson" && (trimmed.startsWith("{") || trimmed.startsWith("["))) return "application/json";
  return "text/plain";
}
