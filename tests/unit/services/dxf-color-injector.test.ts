import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/geodata", () => ({ geodataConfig: { enablePythonColorParser: false } }));

import {
  aciToHex,
  injectDxfColors,
  parseDxfEntityData,
  parseDxfLayerColors,
  resolveEntityAci,
  resolveEntityColor,
  trueColorToHex,
} from "@/server/services/conversion/dxf-color-injector";

import { temporaryFileWith, temporaryUtf8FileWith } from "./helpers";

// Port of tests/Unit/Services/Conversion/DxfColorInjectorTest.php, plus the fallback parser.
describe("DxfColorInjector", () => {
  it.each([
    ["black", 0, "#000000"],
    ["red", 1, "#FF0000"],
    ["white", 7, "#FFFFFF"],
    ["extended orange", 30, "#FF7F00"],
    ["gray ramp", 250, "#333333"],
    ["last code", 255, "#FFFFFF"],
  ])("maps aci color code %s to its hex color", (_label, aci, hex) => {
    expect(aciToHex(aci)).toBe(hex);
  });

  it.each([
    ["bylayer", 256],
    ["negative", -1],
  ])("has no hex color for codes outside the aci range: %s", (_label, aci) => {
    expect(aciToHex(aci)).toBeNull();
  });

  it("formats true colours as uppercase hex", () => {
    expect(trueColorToHex(16711680)).toBe("#FF0000");
    expect(trueColorToHex(0x0a0b0c)).toBe("#0A0B0C");
  });

  const dxf = [
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER",
    "0", "LAYER", "2", "Roads", "62", "-3",
    "0", "LAYER", "2", "Walls", "62", "5", "420", "65280",
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "5", "1a", "8", "Roads",
    "0", "LINE", "5", "1B", "8", "Roads", "62", "1",
    "0", "LINE", "5", "1C", "8", "Walls",
    "0", "POLYLINE", "5", "2A", "8", "Unknown", "420", "255",
    "0", "VERTEX", "5", "2B", "8", "Unknown",
    "0", "SEQEND",
    "0", "ENDSEC",
    "0", "EOF",
  ].join("\r\n");

  it("parses layer colours from the TABLES section", () => {
    expect(parseDxfLayerColors(dxf)).toEqual({
      Roads: { aci: -3, trueColor: null },
      Walls: { aci: 5, trueColor: 65280 },
    });
  });

  it("parses entity data from the ENTITIES section, keeping VERTEX with its POLYLINE", () => {
    expect(parseDxfEntityData(dxf)).toEqual({
      "1A": { color: null, trueColor: null, layer: "Roads" },
      "1B": { color: 1, trueColor: null, layer: "Roads" },
      "1C": { color: null, trueColor: null, layer: "Walls" },
      "2A": { color: null, trueColor: 255, layer: "Unknown" },
    });
  });

  it("resolves entity colours through the DXF priority chain", () => {
    const layers = parseDxfLayerColors(dxf);
    const entities = parseDxfEntityData(dxf);

    expect(resolveEntityColor(entities["1A"], layers)).toBe("#00FF00"); // BYLAYER, |−3|
    expect(resolveEntityAci(entities["1A"], layers)).toBe(3);
    expect(resolveEntityColor(entities["1B"], layers)).toBe("#FF0000");
    expect(resolveEntityColor(entities["1C"], layers)).toBe("#00FF00"); // layer true colour
    expect(resolveEntityAci(entities["1C"], layers)).toBeNull();
    expect(resolveEntityColor(entities["2A"], layers)).toBe("#0000FF");
    expect(resolveEntityColor({ color: 0, trueColor: null, layer: "Missing" }, layers)).toBe("#FFFFFF");
  });

  it("injects RawColor and AciColor into matching GeoJSON features", async () => {
    const dxfPath = temporaryFileWith(dxf, ".dxf");
    const geojsonPath = temporaryUtf8FileWith(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: null, properties: { EntityHandle: "1a", Layer: "Roads" } },
          { type: "Feature", geometry: null, properties: { EntityHandle: "FF" } },
          { type: "Feature", geometry: null, properties: null },
        ],
      }),
      ".geojson",
    );

    expect(await injectDxfColors(dxfPath, geojsonPath)).toBe(true);

    const result = JSON.parse(readFileSync(geojsonPath, "utf8"));
    expect(result.features[0].properties).toEqual({ EntityHandle: "1a", Layer: "Roads", RawColor: "#00FF00", AciColor: 3 });
    expect(result.features[1].properties).toEqual({ EntityHandle: "FF" });
    expect(result.features[2].properties).toBeNull();
  });

  it("skips missing inputs and invalid GeoJSON", async () => {
    const dxfPath = temporaryFileWith(dxf, ".dxf");
    expect(await injectDxfColors(dxfPath, `${dxfPath}.missing`)).toBe(false);
    expect(await injectDxfColors(dxfPath, temporaryUtf8FileWith("not json", ".geojson"))).toBe(false);
  });
});
