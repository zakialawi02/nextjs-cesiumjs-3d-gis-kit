import type { OpenApiSettings } from "./settings";

/**
 * Sample payloads for the OpenAPI document, modelled on real responses of a development database
 * (ids replaced by made-up ULIDs / UUIDs).
 */
export const SAMPLE_IDS = {
  terrainLayer: "01JH8Z9X2Q4K7M3N5P6R8S9T0V",
  vectorLayer: "01JH8ZC4W6Y8A0B2D4F6H8K0M2",
  terrainJob: "01JH8Z9X2P1E3G5J7K9M1N3P5Q",
  vectorJob: "01JH8ZC4W5R7T9V1X3Z5A7B9C1",
  categoryTerrain: "01JH8Y2B4D6F8H0K2M4P6R8T0V",
  categoryDesign: "01JH8Y2B4D6F8H0K2M4P6R8T0W",
  categoryBoundary: "01JH8Y2B4D6F8H0K2M4P6R8T0X",
  categoryOther: "01JH8Y2B4D6F8H0K2M4P6R8T0Y",
  demUpload: "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
  orthoUpload: "3b2a1c0d-9e8f-4a7b-9c6d-5e4f3a2b1c0d",
  vectorUpload: "c7d8e9f0-1a2b-4c3d-9e4f-5a6b7c8d9e0f",
  request: "6e0f8a52-2c47-4d1b-a3f9-7b5c1d2e3f40",
  user: "d5e79ebd-e3cb-41aa-9ba3-e0f3bc3bd88d",
} as const;

const terrainBoundingBox = { east: 117.2635039, west: 117.2551064, north: -0.659641, south: -0.6645944 };
const vectorBoundingBox = { east: 111.28018581, west: 111.25785334, north: -0.62101633, south: -0.65046553 };

export const sampleTerrainDetail = {
  tileset_url: `/geodata/terrain/${SAMPLE_IDS.terrainLayer}`,
  has_ortho: true,
  native_bounding_box: terrainBoundingBox,
  acquisition_date: "12 Jul 2022",
  has_ortho_tiles: true,
  ortho_tiles_url: `/geodata/ortho/${SAMPLE_IDS.terrainLayer}_ortho/{z}/{x}/{y}.png`,
  ortho_min_zoom: 10,
  ortho_max_zoom: 20,
};

export const sampleVectorDetail = {
  geometry_type: "Point",
  feature_count: 34717,
  native_bounding_box: vectorBoundingBox,
  acquisition_date: "N/A",
};

export const sampleCategories = [
  { id: SAMPLE_IDS.categoryTerrain, name: "Terrain & Orthophoto", slug: "terrain-orthophoto", color: "#0ea5e9", icon_url: null },
  { id: SAMPLE_IDS.categoryDesign, name: "Design", slug: "design", color: "#f59e0b", icon_url: "/geodata/icons/layer-categories/q8ZtR2mXk4Wv.webp" },
  { id: SAMPLE_IDS.categoryBoundary, name: "Boundary", slug: "boundary", color: "#10b981", icon_url: null },
  { id: SAMPLE_IDS.categoryOther, name: "Other", slug: "other", color: "#6b7280", icon_url: null },
];

export const sampleLayerList = {
  success: true,
  categories: [
    {
      ...sampleCategories[0],
      layers: [
        {
          id: SAMPLE_IDS.terrainLayer,
          name: "DEM 12-07-2022",
          layer_type: "terrain",
          created_at: "09 Nov 2026",
          terrain_detail: sampleTerrainDetail,
        },
      ],
    },
    {
      ...sampleCategories[1],
      layers: [
        {
          id: SAMPLE_IDS.vectorLayer,
          name: "Pit_design A",
          layer_type: "vector",
          created_at: "09 Nov 2026",
          vector_detail: sampleVectorDetail,
        },
      ],
    },
  ],
};

export const sampleTerrainLayers = {
  success: true,
  layers: [
    {
      id: SAMPLE_IDS.terrainLayer,
      name: "DEM 12-07-2022",
      terrain_detail: { tileset_url: `/geodata/terrain/${SAMPLE_IDS.terrainLayer}`, acquisition_date: "12 Jul 2022" },
    },
  ],
};

export const sampleRecentUploads = {
  success: true,
  jobs: [
    {
      id: SAMPLE_IDS.vectorJob,
      status: "processing",
      status_label: "Processing",
      layer_type: "vector",
      layer_name: "Pit_design A",
      time_diff: "5 seconds ago",
      is_done: false,
      is_failed: false,
    },
    {
      id: SAMPLE_IDS.terrainJob,
      status: "done",
      status_label: "Done",
      layer_type: "terrain",
      layer_name: "DEM 12-07-2022",
      time_diff: "7 minutes ago",
      is_done: true,
      is_failed: false,
    },
  ],
};

export const sampleTerrainLayerJson = {
  tilejson: "2.1.0",
  name: "01JH8Z9X2R3S4T5V6W7X8Y9Z0A.tif_wgs84",
  description: "",
  version: "1.1.0",
  format: "quantized-mesh-1.0",
  attribution: "",
  schema: "tms",
  extensions: ["octvertexnormals"],
  tiles: ["{z}/{x}/{y}.terrain?v={version}&terrain_revision=3"],
  projection: "EPSG:4326",
  bounds: [0, -90, 180, 90],
  available: [
    [{ startX: 0, startY: 0, endX: 1, endY: 0 }],
    [{ startX: 3, startY: 0, endX: 3, endY: 0 }],
    [{ startX: 6, startY: 1, endX: 6, endY: 1 }],
  ],
};

export const sampleFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: 1,
      geometry: { type: "Point", coordinates: [111.27007791, -0.63805738, 1.839] },
      properties: { name: "BH-01", elevation: 1.839 },
    },
    {
      type: "Feature",
      id: 2,
      geometry: {
        type: "LineString",
        coordinates: [
          [111.26993934, -0.63790757],
          [111.26985618, -0.63766186],
        ],
      },
      properties: { name: "Haul road", width_m: 12 },
    },
  ],
};

export function sampleUploadSession(settings: OpenApiSettings) {
  const fileSize = 5_242_880;
  return {
    identifier: SAMPLE_IDS.demUpload,
    fileName: "DEM_120722.tif",
    fileSize,
    chunkSize: settings.chunkBytes,
    totalChunks: Math.ceil(fileSize / settings.chunkBytes),
    chunks: { "0": "3f5d0b1a9c2e4d6f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f" },
    status: "uploading",
    job_id: null,
    expiresAt: "2026-11-10T09:30:00+00:00",
  };
}

export const sampleTerrainJobDone = {
  success: true,
  status: "done",
  error_message: null,
  finished_at: "2026-11-09T16:53:34+00:00",
  layer: {
    id: SAMPLE_IDS.terrainLayer,
    name: "DEM 12-07-2022",
    type: "terrain",
    created_at: "8 minutes ago",
    terrain_detail: sampleTerrainDetail,
  },
  source_file: { name: "DEM_120722.tif", size: 698081 },
};

export const sampleVectorJobDone = {
  success: true,
  status: "done",
  error_message: null,
  finished_at: "2026-11-09T16:55:36+00:00",
  layer: {
    id: SAMPLE_IDS.vectorLayer,
    name: "Pit_design A",
    type: "vector",
    created_at: "6 minutes ago",
    vector_detail: sampleVectorDetail,
  },
  source_file: { name: "pit_design_a.str", size: 3896925 },
};

export const sampleSession = {
  user: {
    id: SAMPLE_IDS.user,
    name: "Admin User",
    email: "admin@mail.com",
    image: "/assets/img/profile/admin.png",
    username: "admin",
    role: "admin",
  },
  expires: "2026-12-09T17:01:21.802Z",
};
