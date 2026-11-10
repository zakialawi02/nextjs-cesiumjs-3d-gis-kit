import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseStrFile, writeStrGeoJson } from "@/server/services/conversion/surpac-str-parser-service";

import { temporaryFileWith, temporaryPath } from "./helpers";

// Port of tests/Unit/Services/Conversion/SurpacStrParserServiceTest.php. Features carry
// `properties: {}` (PHP encoded the empty array as `[]`).
describe("SurpacStrParserService", () => {
  it.each([
    ["comma delimited", "1, 100.5, 200.25, 10.0\n1, 110.0, 210.0, 12.5\n"],
    ["whitespace delimited", "1   100.5   200.25   10.0\n1\t110.0\t210.0\t12.5\n"],
  ])("turns string records into line features in easting, northing, elevation order (%s)", async (_label, contents) => {
    const collection = await parseStrFile(temporaryFileWith(contents));

    expect(collection).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [200.25, 100.5, 10.0],
              [210.0, 110.0, 12.5],
            ],
          },
          properties: {},
        },
      ],
    });
  });

  it("skips header, axis and blank lines and splits features at segment terminators", async () => {
    const path = temporaryFileWith(
      [
        "pit,  1-Jan-26,,ssi_styles:styles.ssi",
        "0,           0.000,           0.000,           0.000,           0.000,           0.000,           0.000",
        "",
        "5, 1000.0, 2000.0, 50.0, description",
        "5, 1001.0, 2001.0, 51.0",
        "0, 0.0, 0.0, 0.0",
        "7, 3000.0, 4000.0, 60.0",
        "0, 0.0, 0.0, 0.0",
        "0, 0.0, 0.0, 0.0, END",
      ].join("\n"),
    );

    const { features } = await parseStrFile(path);

    expect(features).toEqual([
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [2000.0, 1000.0, 50.0],
            [2001.0, 1001.0, 51.0],
          ],
        },
        properties: {},
      },
      { type: "Feature", geometry: { type: "Point", coordinates: [4000.0, 3000.0, 60.0] }, properties: {} },
    ]);
  });

  it("still emits an unterminated final segment", async () => {
    const { features } = await parseStrFile(temporaryFileWith("1, 10.0, 20.0, 30.0\n1, 11.0, 21.0, 31.0"));

    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates).toEqual([
      [20.0, 10.0, 30.0],
      [21.0, 11.0, 31.0],
    ]);
  });

  it("produces an empty collection for a file without data records", async () => {
    const collection = await parseStrFile(temporaryFileWith("pit,  1-Jan-26,,ssi_styles:styles.ssi\n0, 0.0, 0.0, 0.0\n"));

    expect(collection).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("writes the parsed features as a GeoJSON file", async () => {
    const input = temporaryFileWith("1, 100.5, 200.25, 10.0\n1, 110.0, 210.0, 12.5\n0, 0.0, 0.0, 0.0\n2, 1.0, 2.0, 3.0\n");
    const output = temporaryPath(".geojson");

    await writeStrGeoJson(input, output);

    expect(readFileSync(output, "utf8")).toBe(
      '{"type":"FeatureCollection","features":[' +
        '{"type":"Feature","geometry":{"type":"LineString","coordinates":[[200.25,100.5,10],[210,110,12.5]]},"properties":{}},' +
        '{"type":"Feature","geometry":{"type":"Point","coordinates":[2,1,3]},"properties":{}}' +
        "]}",
    );
  });

  it("writes an empty collection for a file without data records", async () => {
    const output = temporaryPath(".geojson");

    await writeStrGeoJson(temporaryFileWith("header line\n"), output);

    expect(readFileSync(output, "utf8")).toBe('{"type":"FeatureCollection","features":[]}');
  });

  it("rejects a line longer than the processing limit", async () => {
    const path = temporaryFileWith(`1, 1.0, 2.0, 3.0, ${"x".repeat(70000)}\n1, 1.0, 2.0, 3.0\n`);

    await expect(parseStrFile(path)).rejects.toThrow("STR line exceeds the processing limit.");
  });

  it("rejects a segment with more than 100000 vertices", async () => {
    const path = temporaryFileWith("1, 1.0, 2.0, 3.0\n".repeat(100001));

    await expect(parseStrFile(path)).rejects.toThrow("STR segment exceeds the 100,000 vertex limit.");
  });

  it("never turns a string-0 axis record with real coordinates into a vertex", async () => {
    const path = temporaryFileWith(
      [
        "pit,05-Jul-22,,styles.ssi",
        "0,     9928558.570,      529165.399,          29.882,           0.000,           0.000,           0.000",
        "1, 9929474.670, 530051.170, 1.839, 1",
        "0, 0.000, 0.000, 0.000,",
        "2, 9929484.820, 530044.300, 1.097",
        "2, 9929491.230, 530035.753, 1.548",
      ].join("\n"),
    );

    const { features } = await parseStrFile(path);

    expect(features.map((feature) => feature.geometry)).toEqual([
      { type: "Point", coordinates: [530051.17, 9929474.67, 1.839] },
      {
        type: "LineString",
        coordinates: [
          [530044.3, 9929484.82, 1.097],
          [530035.753, 9929491.23, 1.548],
        ],
      },
    ]);
  });

  it("accepts CRLF line endings and a final line without newline", async () => {
    const { features } = await parseStrFile(temporaryFileWith("1,1,2,3\r\n1,4,5,6"));

    expect(features[0].geometry.coordinates).toEqual([
      [2, 1, 3],
      [5, 4, 6],
    ]);
  });
});
