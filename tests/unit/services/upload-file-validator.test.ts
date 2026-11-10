import { describe, expect, it } from "vitest";

import { detectMimeType, validateUploadedFile } from "@/server/services/upload/upload-file-validator";

import { temporaryFileWith } from "./helpers";

// Port of tests/Unit/Services/Upload/UploadFileValidatorTest.php
describe("UploadFileValidator", () => {
  it.each([
    ["little-endian tiff", "tif", "II\x2a\x00rest"],
    ["big-endian tiff", "tiff", "MM\x00\x2arest"],
    ["little-endian bigtiff", "geotiff", "II\x2b\x00rest"],
    ["big-endian bigtiff", "tif", "MM\x00\x2brest"],
    ["uppercase extension", "TIF", "II\x2a\x00rest"],
    ["zip archive", "zip", "PK\x03\x04rest"],
    ["dwg drawing", "dwg", "AC1032rest"],
    ["ascii dxf", "dxf", "  0\nSECTION\n  2\nHEADER\n"],
    ["binary dxf", "dxf", "AutoCAD Binary DXF\r\n\x1a\x00rest"],
    ["comma delimited str", "str", "pit, 1-Jan-26,,\n1, 100.5, 200.25, 10.0\n"],
    ["whitespace delimited str", "str", "1 100.5 -200.25 10.0\n"],
    ["geojson collection", "geojson", '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}]}'],
  ])("accepts files whose content matches their extension: %s", async (_label, extension, contents) => {
    await expect(validateUploadedFile(temporaryFileWith(contents), extension)).resolves.toBeUndefined();
  });

  it.each([
    ["png renamed to tif", "tif", "\x89PNG\r\n\x1a\n"],
    ["text renamed to zip", "zip", "not an archive"],
    ["invalid dwg version", "dwg", "AC10XXrest"],
    ["dwg signature not at start", "dwg", "xAC1032"],
    ["dxf without sections", "dxf", "999\ncomment only\n"],
    ["binary str", "str", "1, 100.5, 200.25, 10.0\x00"],
    ["str without coordinates", "str", "pit, 1-Jan-26,,\nheader only\n"],
    ["unsupported extension", "exe", "MZ"],
  ])("rejects files whose content does not match their extension: %s", async (_label, extension, contents) => {
    await expect(validateUploadedFile(temporaryFileWith(contents), extension)).rejects.toThrow(
      "File content does not match the supported format.",
    );
  });

  it("rejects an empty file", async () => {
    await expect(validateUploadedFile(temporaryFileWith(""), "zip")).rejects.toThrow("Uploaded file is empty.");
  });

  it("validates geojson files through the whole document", async () => {
    const path = temporaryFileWith('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null},{"type":"Point"}]}');

    await expect(validateUploadedFile(path, "geojson")).rejects.toThrow("Invalid GeoJSON feature.");
  });

  it("only treats line starts after a newline as STR records", async () => {
    await expect(validateUploadedFile(temporaryFileWith("header\r1, 2, 3, 4"), "str")).rejects.toThrow(
      "File content does not match the supported format.",
    );
    await expect(validateUploadedFile(temporaryFileWith("header\n  1, 2, 3, 4"), "str")).resolves.toBeUndefined();
  });

  it.each([
    ["tif", "II\x2a\x00rest", "image/tiff"],
    ["zip", "PK\x03\x04rest", "application/zip"],
    ["dwg", "AC1032rest", "image/vnd.dwg"],
    ["geojson", '{"type":"FeatureCollection","features":[]}', "application/json"],
    ["str", "1, 2, 3, 4\n", "text/plain"],
  ])("detects the MIME type of a %s file", async (extension, contents, mime) => {
    expect(await detectMimeType(temporaryFileWith(contents), extension)).toBe(mime);
  });
});
