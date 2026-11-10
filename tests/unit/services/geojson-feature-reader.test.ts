import { describe, expect, it } from "vitest";

import { collectGeoJsonFeatures, JsonException } from "@/server/services/upload/geojson-feature-reader";

import { temporaryUtf8FileWith } from "./helpers";

// Port of tests/Unit/Services/Upload/GeoJsonFeatureReaderTest.php
function readGeoJsonFeatures(contents: string) {
  return collectGeoJsonFeatures(temporaryUtf8FileWith(contents, ".geojson"));
}

describe("GeoJsonFeatureReader", () => {
  it("yields each feature of a feature collection", async () => {
    const features = await readGeoJsonFeatures(`
      {
        "type": "FeatureCollection",
        "name": "survey",
        "features": [
          {"type": "Feature", "geometry": {"type": "Point", "coordinates": [106.8, -6.2]}, "properties": {"id": 1}},
          {"type": "Feature", "geometry": null}
        ]
      }
    `);

    expect(features).toEqual([
      { type: "Feature", geometry: { type: "Point", coordinates: [106.8, -6.2] }, properties: { id: 1 } },
      { type: "Feature", geometry: null },
    ]);
  });

  it("does not end a feature at braces, brackets or escaped quotes inside strings", async () => {
    const features = await readGeoJsonFeatures(
      '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null,"properties":{"note":"a } ] \\" [ {"}}]}',
    );

    expect(features[0].properties?.note).toBe('a } ] " [ {');
  });

  it("accepts root members after the features array", async () => {
    const features = await readGeoJsonFeatures('{"features":[{"type":"Feature","geometry":null}],"type":"FeatureCollection","bbox":[0,0,1,1]}');

    expect(features).toEqual([{ type: "Feature", geometry: null }]);
  });

  it("yields nothing for an empty feature collection", async () => {
    expect(await readGeoJsonFeatures('{"type":"FeatureCollection","features":[]}')).toEqual([]);
  });

  it("handles features split across read blocks and multi-byte characters", async () => {
    const name = "Jalan Ā ".repeat(20000);
    const features = await readGeoJsonFeatures(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: { name } },
          { type: "Feature", geometry: null, properties: { n: 2 } },
        ],
      }),
    );

    expect(features).toHaveLength(2);
    expect(features[0].properties?.name).toBe(name);
    expect(features[1].properties).toEqual({ n: 2 });
  });

  it.each([
    ["trailing comma", '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null},]}', "Trailing comma in GeoJSON features."],
    [
      "missing comma between features",
      '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null} {"type":"Feature","geometry":null}]}',
      "Invalid GeoJSON feature list.",
    ],
    ["non-object list item", '{"type":"FeatureCollection","features":[1]}', "Invalid GeoJSON feature list."],
    ["wrong feature type", '{"type":"FeatureCollection","features":[{"type":"Point","geometry":null}]}', "Invalid GeoJSON feature."],
    ["missing geometry", '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{}}]}', "Invalid GeoJSON feature."],
    [
      "scalar geometry",
      '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":"POINT (1 2)"}]}',
      "Invalid GeoJSON geometry or properties.",
    ],
    [
      "scalar properties",
      '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null,"properties":"name"}]}',
      "Invalid GeoJSON geometry or properties.",
    ],
    ["duplicate features array", '{"type":"FeatureCollection","features":[],"features":[]}', "Duplicate GeoJSON features array."],
    ["wrong root type", '{"type":"GeometryCollection","features":[]}', "Expected a valid GeoJSON FeatureCollection."],
    ["missing features array", '{"type":"FeatureCollection"}', "Expected a valid GeoJSON FeatureCollection."],
    ["nested features array only", '{"type":"FeatureCollection","meta":{"features":[]}}', "Expected a valid GeoJSON FeatureCollection."],
  ])("rejects malformed documents: %s", async (_label, contents, message) => {
    await expect(readGeoJsonFeatures(contents)).rejects.toThrow(message);
  });

  it("rejects truncated documents as invalid json", async () => {
    await expect(readGeoJsonFeatures('{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}')).rejects.toBeInstanceOf(
      JsonException,
    );
  });

  it("rejects features nested deeper than json_decode allows", async () => {
    const deep = `${"[".repeat(130)}${"]".repeat(130)}`;
    await expect(
      readGeoJsonFeatures(`{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null,"properties":{"x":${deep}}}]}`),
    ).rejects.toBeInstanceOf(JsonException);
  });
});
