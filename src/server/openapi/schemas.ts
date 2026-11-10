import { JobStatus, LayerType, USER_ROLES } from "@/lib/enums";

import { formatSize, nullable, schemaRef } from "./helpers";
import { SAMPLE_IDS } from "./examples";
import type { OpenApiSettings } from "./settings";
import type { SchemaObject } from "./types";

/**
 * Patterns shared with the route handlers. The terrain / ortho tile routes accept any 26
 * alphanumerics; DELETE /geodata/layers/{layer} and the job status route use the stricter
 * Crockford check of Str::isUlid().
 */
export const ULID_PATTERN = "^[0-9A-Za-z]{26}$";
export const CROCKFORD_ULID_PATTERN = "^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$";
export const ICON_FILE_PATTERN = "^[A-Za-z0-9]{1,64}\\.(png|webp)$";
export const SHA256_PATTERN = "^[a-f0-9]{64}$";
export const EPSG_PATTERN = "^EPSG:[1-9][0-9]{2,6}$";
/** Carbon "d M Y" in UTC, e.g. "09 Nov 2026". */
const DISPLAY_DATE_PATTERN = "^[0-9]{2} [A-Z][a-z]{2} [0-9]{4}$";

const UPLOAD_SESSION_STATUSES = ["uploading", "queued", "assembled", "failed", "cancelled"];

const displayDate = (description: string): SchemaObject => ({
  type: "string",
  pattern: DISPLAY_DATE_PATTERN,
  description,
  examples: ["09 Nov 2026"],
});

const acquisitionDate: SchemaObject = {
  type: "string",
  description: 'Acquisition date as "d M Y" (UTC), or "N/A" when none was given.',
  examples: ["12 Jul 2022", "N/A"],
};

const relativeTime = (description: string): SchemaObject => ({
  type: "string",
  description: `${description} Human-readable relative time (Carbon diffForHumans), not machine-parseable.`,
  examples: ["5 minutes ago"],
});

const successTrue: SchemaObject = { type: "boolean", const: true };

export function buildSchemas(settings: OpenApiSettings): Record<string, SchemaObject> {
  const maxUploadBytes = settings.maxUploadMb * 1024 * 1024;
  const chunkKb = Math.ceil(settings.chunkBytes / 1024);
  const extensions = settings.allowedExtensions.map((extension) => `\`.${extension}\``).join(", ");

  const completionProperties: Record<string, SchemaObject> = {
    layerName: { type: "string", minLength: 1, maxLength: 255, description: "Name of the new layer." },
    sourceEpsg: {
      type: ["string", "null"],
      pattern: EPSG_PATTERN,
      description:
        "Source coordinate reference system as `EPSG:<code>`. Required for CAD / Surpac files (`.dxf`, `.dwg`, `.str`); " +
        "GeoTIFF, GeoJSON and Shapefile uploads carry their own CRS.",
      examples: [settings.defaultEpsg],
    },
    acquisitionDate: {
      type: ["string", "null"],
      format: "date",
      description: "Survey / acquisition date as `YYYY-MM-DD`.",
      examples: ["2022-07-12"],
    },
    layer_category_id: {
      type: ["string", "null"],
      pattern: ULID_PATTERN,
      description: "Id of an existing layer category (`GET /geodata/layer-categories`). Empty or null files the layer under \"Other\".",
      examples: [SAMPLE_IDS.categoryTerrain],
    },
  };

  return {
    // ---------------------------------------------------------------- errors
    Error: {
      type: "object",
      description: "Error body of every `/geodata/*` endpoint.",
      required: ["message"],
      properties: { message: { type: "string", examples: ["Not Found"] } },
    },
    ValidationError: {
      type: "object",
      description: "422 body (Laravel format): the first message plus every invalid field with its messages.",
      required: ["message", "errors"],
      properties: {
        message: { type: "string", examples: ["The layer name field is required."] },
        errors: {
          type: "object",
          additionalProperties: { type: "array", items: { type: "string" }, minItems: 1 },
          examples: [{ layerName: ["The layer name field is required."] }],
        },
      },
    },
    Success: {
      type: "object",
      required: ["success"],
      properties: { success: successTrue },
    },

    // ---------------------------------------------------------------- shared values
    Ulid: { type: "string", pattern: ULID_PATTERN, description: "ULID (26 characters).", examples: [SAMPLE_IDS.terrainLayer] },
    UploadIdentifier: {
      type: "string",
      format: "uuid",
      description: "Upload session id (UUID) returned by `POST /geodata/upload/sessions`.",
      examples: [SAMPLE_IDS.demUpload],
    },
    LayerType: {
      type: "string",
      enum: Object.values(LayerType),
      description: "`terrain` (DEM + optional orthophoto) or `vector`. `imagery` is reserved and not produced by uploads.",
    },
    JobStatus: {
      type: "string",
      enum: Object.values(JobStatus),
      description: "Conversion job status: `queued` → `processing` → `done` or `failed`.",
    },
    UploadSessionStatus: {
      type: "string",
      enum: UPLOAD_SESSION_STATUSES,
      description:
        "`uploading` accepts chunks; `queued` / `assembled` were submitted for processing; `failed` and `cancelled` are final.",
    },
    UserRole: { type: "string", enum: USER_ROLES, description: "`admin`: full access. `engineering`: read-only geodata." },
    BoundingBox: {
      type: "object",
      description: "Extent in WGS84 degrees.",
      required: ["west", "south", "east", "north"],
      properties: {
        west: { type: "number" },
        south: { type: "number" },
        east: { type: "number" },
        north: { type: "number" },
      },
    },

    // ---------------------------------------------------------------- layers & categories
    Category: {
      type: "object",
      required: ["id", "name", "slug", "color", "icon_url"],
      properties: {
        id: schemaRef("Ulid"),
        name: { type: "string", examples: ["Terrain & Orthophoto"] },
        slug: { type: "string", examples: ["terrain-orthophoto"] },
        color: { type: "string", description: "CSS hex colour.", examples: ["#0ea5e9"] },
        icon_url: {
          type: ["string", "null"],
          description: "Uploaded icon (`GET /geodata/icons/layer-categories/{icon}`), or null for the default icon.",
          examples: ["/geodata/icons/layer-categories/q8ZtR2mXk4Wv.webp"],
        },
      },
    },
    TerrainDetail: {
      type: "object",
      required: [
        "tileset_url",
        "has_ortho",
        "native_bounding_box",
        "acquisition_date",
        "has_ortho_tiles",
        "ortho_tiles_url",
        "ortho_min_zoom",
        "ortho_max_zoom",
      ],
      properties: {
        tileset_url: {
          type: ["string", "null"],
          description: "Base URL of the quantized-mesh tileset (same origin); Cesium loads `{tileset_url}/layer.json`.",
          examples: [`/geodata/terrain/${SAMPLE_IDS.terrainLayer}`],
        },
        has_ortho: { type: "boolean", description: "An orthophoto was uploaded with the DEM." },
        native_bounding_box: nullable(schemaRef("BoundingBox")),
        acquisition_date: acquisitionDate,
        has_ortho_tiles: { type: "boolean", description: "Orthophoto XYZ tiles were generated." },
        ortho_tiles_url: {
          type: ["string", "null"],
          description: "XYZ URL template of the orthophoto tiles.",
          examples: [`/geodata/ortho/${SAMPLE_IDS.terrainLayer}_ortho/{z}/{x}/{y}.png`],
        },
        ortho_min_zoom: { type: ["integer", "null"], examples: [10] },
        ortho_max_zoom: { type: ["integer", "null"], examples: [20] },
      },
    },
    VectorDetail: {
      type: "object",
      required: ["geometry_type", "feature_count", "native_bounding_box", "acquisition_date"],
      properties: {
        geometry_type: {
          type: ["string", "null"],
          description: "Dominant PostGIS geometry type.",
          examples: ["Point", "LineString", "MultiPolygon"],
        },
        feature_count: { type: "integer", minimum: 0 },
        native_bounding_box: nullable(schemaRef("BoundingBox")),
        acquisition_date: acquisitionDate,
      },
    },
    Layer: {
      type: "object",
      description: "A published layer. `terrain_detail` is present on terrain layers, `vector_detail` on vector layers.",
      required: ["id", "name", "layer_type", "created_at"],
      properties: {
        id: schemaRef("Ulid"),
        name: { type: "string" },
        layer_type: schemaRef("LayerType"),
        created_at: displayDate("Upload date."),
        terrain_detail: schemaRef("TerrainDetail"),
        vector_detail: schemaRef("VectorDetail"),
      },
    },
    CategoryWithLayers: {
      allOf: [
        schemaRef("Category"),
        {
          type: "object",
          required: ["layers"],
          properties: {
            layers: { type: "array", items: schemaRef("Layer"), minItems: 1, description: "Newest first." },
          },
        },
      ],
    },
    LayerListResponse: {
      type: "object",
      required: ["success", "categories"],
      properties: {
        success: successTrue,
        categories: {
          type: "array",
          items: schemaRef("CategoryWithLayers"),
          description: "Categories in their sort order; categories without matching layers are left out.",
        },
      },
    },
    TerrainLayerSummary: {
      type: "object",
      required: ["id", "name", "terrain_detail"],
      properties: {
        id: schemaRef("Ulid"),
        name: { type: "string" },
        terrain_detail: nullable({
          type: "object",
          required: ["tileset_url", "acquisition_date"],
          properties: {
            tileset_url: { type: ["string", "null"], examples: [`/geodata/terrain/${SAMPLE_IDS.terrainLayer}`] },
            acquisition_date: acquisitionDate,
          },
        }),
      },
    },
    TerrainLayerListResponse: {
      type: "object",
      required: ["success", "layers"],
      properties: {
        success: successTrue,
        layers: { type: "array", items: schemaRef("TerrainLayerSummary"), description: "Newest first." },
      },
    },
    CategoryListResponse: {
      type: "object",
      required: ["success", "categories"],
      properties: { success: successTrue, categories: { type: "array", items: schemaRef("Category") } },
    },
    RecentUpload: {
      type: "object",
      required: ["id", "status", "status_label", "layer_type", "layer_name", "time_diff", "is_done", "is_failed"],
      properties: {
        id: { ...schemaRef("Ulid"), description: "Conversion job id." },
        status: schemaRef("JobStatus"),
        status_label: { type: "string", examples: ["Processing"] },
        layer_type: schemaRef("LayerType"),
        layer_name: {
          type: "string",
          description: 'Layer name, else the uploaded file name, else "Processing...".',
        },
        time_diff: relativeTime("Since the job finished (or was created)."),
        is_done: { type: "boolean" },
        is_failed: { type: "boolean" },
      },
    },
    RecentUploadsResponse: {
      type: "object",
      required: ["success", "jobs"],
      properties: {
        success: successTrue,
        jobs: { type: "array", items: schemaRef("RecentUpload"), maxItems: 10, description: "The 10 newest conversion jobs." },
      },
    },
    LayerDeletedResponse: {
      type: "object",
      required: ["success", "message"],
      properties: { success: successTrue, message: { type: "string", const: "Layer deleted." } },
    },
    LayerBusyResponse: {
      type: "object",
      required: ["success", "message"],
      properties: {
        success: { type: "boolean", const: false },
        message: {
          type: "string",
          examples: ["This layer is still being processed. Wait until its conversion finishes or fails before deleting it."],
        },
      },
    },

    // ---------------------------------------------------------------- tiles & vector data
    TileAvailability: {
      type: "object",
      required: ["startX", "startY", "endX", "endY"],
      properties: {
        startX: { type: "integer" },
        startY: { type: "integer" },
        endX: { type: "integer" },
        endY: { type: "integer" },
      },
    },
    TerrainLayerJson: {
      type: "object",
      description:
        "Quantized-mesh `layer.json` written by Cesium Terrain Builder. The server appends " +
        "`terrain_revision=<n>` to each `tiles` template so browsers drop tiles cached before a regeneration.",
      required: ["format", "tiles"],
      additionalProperties: true,
      properties: {
        tilejson: { type: "string", examples: ["2.1.0"] },
        name: { type: "string" },
        description: { type: "string" },
        version: { type: "string", examples: ["1.1.0"] },
        format: { type: "string", examples: ["quantized-mesh-1.0"] },
        attribution: { type: "string" },
        schema: { type: "string", examples: ["tms"] },
        extensions: { type: "array", items: { type: "string" }, examples: [["octvertexnormals"]] },
        tiles: {
          type: "array",
          items: { type: "string" },
          description: "Tile URL templates relative to the tileset URL.",
          examples: [["{z}/{x}/{y}.terrain?v={version}&terrain_revision=3"]],
        },
        projection: { type: "string", examples: ["EPSG:4326"] },
        bounds: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
        available: {
          type: "array",
          description: "Per zoom level, the tile ranges that exist.",
          items: { type: "array", items: schemaRef("TileAvailability") },
        },
      },
    },
    GeoJsonGeometry: {
      type: "object",
      description: "GeoJSON geometry in WGS84 (from PostGIS `ST_AsGeoJSON`); coordinates may carry a Z value.",
      required: ["type"],
      properties: {
        type: {
          type: "string",
          enum: ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"],
        },
        coordinates: { type: "array" },
        geometries: { type: "array", items: schemaRef("GeoJsonGeometry") },
      },
    },
    GeoJsonFeature: {
      type: "object",
      required: ["type", "id", "geometry", "properties"],
      properties: {
        type: { type: "string", const: "Feature" },
        id: { type: ["integer", "string", "null"], description: "Row id in the layer's PostGIS table." },
        geometry: nullable(schemaRef("GeoJsonGeometry")),
        properties: {
          type: "object",
          additionalProperties: true,
          description: "Attribute columns of the source file (the internal `attr_` prefix is removed).",
        },
      },
    },
    FeatureCollection: {
      type: "object",
      required: ["type", "features"],
      properties: {
        type: { type: "string", const: "FeatureCollection" },
        features: { type: "array", items: schemaRef("GeoJsonFeature") },
      },
    },

    // ---------------------------------------------------------------- upload
    UploadSession: {
      type: "object",
      required: ["identifier", "fileName", "fileSize", "chunkSize", "totalChunks", "chunks", "status", "job_id", "expiresAt"],
      properties: {
        identifier: schemaRef("UploadIdentifier"),
        fileName: { type: "string" },
        fileSize: { type: "integer", minimum: 1, description: "Bytes." },
        chunkSize: {
          type: "integer",
          description: `Bytes per chunk (${formatSize(settings.chunkBytes)}); the last chunk holds the remainder.`,
          examples: [settings.chunkBytes],
        },
        totalChunks: { type: "integer", minimum: 1, description: "`ceil(fileSize / chunkSize)`." },
        chunks: {
          type: "object",
          description: "Chunks already stored: chunk index → SHA-256 hex of its bytes. Upload only the missing indexes when resuming.",
          propertyNames: { pattern: "^[0-9]+$" },
          additionalProperties: { type: "string", pattern: SHA256_PATTERN },
        },
        status: schemaRef("UploadSessionStatus"),
        job_id: {
          type: ["string", "null"],
          pattern: ULID_PATTERN,
          description: "Conversion job id once the upload was submitted.",
        },
        expiresAt: {
          type: "string",
          format: "date-time",
          description: `When an unfinished session expires (${settings.sessionHours} h after creation or the last stored chunk).`,
        },
      },
    },
    UploadSessionResponse: {
      type: "object",
      required: ["success", "session"],
      properties: { success: successTrue, session: schemaRef("UploadSession") },
    },
    StartUploadSessionRequest: {
      type: "object",
      required: ["fileName", "fileSize"],
      properties: {
        fileName: {
          type: "string",
          maxLength: 255,
          description:
            `Original file name (at most 255 bytes, no control characters or \`<>:"/\\|?*\`). Allowed extensions: ${extensions}.`,
          examples: ["DEM_120722.tif"],
        },
        fileSize: {
          type: "integer",
          minimum: 1,
          maximum: maxUploadBytes,
          description: `File size in bytes, at most ${settings.maxUploadMb} MB (GEODATA_MAX_UPLOAD_MB).`,
          examples: [5_242_880],
        },
        requestId: {
          type: ["string", "null"],
          format: "uuid",
          description:
            "Client-generated idempotency key for this file. Repeating a request with the same `requestId` returns the " +
            "existing session (409 if the file name or size differ). Omit it to always create a new session.",
          examples: [SAMPLE_IDS.request],
        },
      },
    },
    UploadChunkRequest: {
      type: "object",
      required: ["file", "identifier", "chunkIndex", "checksum"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          contentMediaType: "application/octet-stream",
          description:
            `The chunk bytes: exactly \`min(chunkSize, fileSize - chunkIndex * chunkSize)\` bytes, at most ${chunkKb} KB.`,
        },
        identifier: schemaRef("UploadIdentifier"),
        chunkIndex: { type: "integer", minimum: 0, description: "Zero-based chunk index, below `totalChunks`." },
        checksum: {
          type: "string",
          pattern: SHA256_PATTERN,
          description: "Lowercase hex SHA-256 of the chunk bytes.",
          examples: ["3f5d0b1a9c2e4d6f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f"],
        },
      },
    },
    AssembleRasterRequest: {
      type: "object",
      description: "Unknown fields are ignored.",
      required: ["layerName", "demIdentifier"],
      properties: {
        ...completionProperties,
        demIdentifier: {
          type: "string",
          format: "uuid",
          description: "Completed upload session of the DEM GeoTIFF (`.tif`, `.tiff`, `.geotiff`).",
          examples: [SAMPLE_IDS.demUpload],
        },
        orthoIdentifier: {
          type: ["string", "null"],
          format: "uuid",
          description: "Optional completed upload session of an orthophoto GeoTIFF; must differ from `demIdentifier`.",
          examples: [SAMPLE_IDS.orthoUpload],
        },
      },
    },
    AssembleVectorRequest: {
      type: "object",
      description: "Unknown fields are ignored.",
      required: ["layerName", "identifier"],
      properties: {
        ...completionProperties,
        identifier: {
          type: "string",
          format: "uuid",
          description: "Completed upload session of the vector file (`.geojson`, `.zip` Shapefile, `.dxf`, `.dwg`, `.str`).",
          examples: [SAMPLE_IDS.vectorUpload],
        },
      },
    },
    UploadQueuedResponse: {
      type: "object",
      required: ["success", "message", "job_id"],
      properties: {
        success: successTrue,
        message: { type: "string", const: "Upload queued for verification and processing." },
        job_id: { ...schemaRef("Ulid"), description: "Conversion job id to poll with `GET /geodata/upload/status/{job}`." },
      },
    },
    UploadedLayer: {
      type: "object",
      required: ["id", "name", "type", "created_at"],
      properties: {
        id: schemaRef("Ulid"),
        name: { type: "string" },
        type: schemaRef("LayerType"),
        created_at: relativeTime("Since the layer was created."),
        terrain_detail: nullable(schemaRef("TerrainDetail")),
        vector_detail: nullable(schemaRef("VectorDetail")),
      },
    },
    UploadStatusResponse: {
      type: "object",
      description: "`layer` and `source_file` are only present once `status` is `done`.",
      required: ["success", "status", "error_message", "finished_at"],
      properties: {
        success: successTrue,
        status: schemaRef("JobStatus"),
        error_message: {
          type: ["string", "null"],
          description: "Generic message when `status` is `failed` (details are in the server's conversion logs).",
          examples: ["File processing failed. Please contact an administrator with the job ID."],
        },
        finished_at: { type: ["string", "null"], format: "date-time" },
        layer: schemaRef("UploadedLayer"),
        source_file: {
          type: "object",
          required: ["name", "size"],
          properties: { name: { type: "string" }, size: { type: "integer", description: "Bytes." } },
        },
      },
    },

    // ---------------------------------------------------------------- health
    HealthStatus: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", enum: ["up", "down"] } },
    },

    // ---------------------------------------------------------------- auth (NextAuth)
    CsrfTokenResponse: {
      type: "object",
      required: ["csrfToken"],
      properties: { csrfToken: { type: "string", examples: ["c475adb775d3008696770132c5967c71da3acbde6f8eb61539fc4246d9cff367"] } },
    },
    CredentialsSignInRequest: {
      type: "object",
      required: ["csrfToken", "id_user", "password"],
      properties: {
        csrfToken: { type: "string", description: "Token from `GET /api/auth/csrf` (send its `next-auth.csrf-token` cookie too)." },
        id_user: { type: "string", maxLength: 255, description: "Username or email (case-insensitive).", examples: ["admin"] },
        password: { type: "string", format: "password", writeOnly: true },
        remember: {
          type: "string",
          enum: ["true", "false", "on"],
          default: "false",
          description:
            `\`true\` / \`on\` keeps the session for 30 days; otherwise it ends after ${settings.sessionLifetimeMinutes} idle minutes (SESSION_LIFETIME).`,
        },
        json: {
          type: "string",
          const: "true",
          description: "Answer with `{ url }` JSON instead of a 302 redirect. Always send it from API clients.",
        },
        callbackUrl: { type: "string", description: "Where `url` should point after signing in (same origin).", examples: ["/"] },
      },
    },
    SignOutRequest: {
      type: "object",
      required: ["csrfToken"],
      properties: {
        csrfToken: { type: "string" },
        json: { type: "string", const: "true" },
        callbackUrl: { type: "string", examples: ["/login"] },
      },
    },
    AuthUrlResponse: {
      type: "object",
      description: "NextAuth's JSON answer (`json=true`): where a browser would be redirected.",
      required: ["url"],
      properties: { url: { type: "string", format: "uri" } },
    },
    SessionUser: {
      type: "object",
      required: ["id", "name", "email", "image", "username", "role"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        email: { type: "string", format: "email" },
        image: { type: ["string", "null"], description: "Profile photo URL." },
        username: { type: "string" },
        role: schemaRef("UserRole"),
      },
    },
    Session: {
      type: "object",
      required: ["user", "expires"],
      properties: {
        user: schemaRef("SessionUser"),
        expires: { type: "string", format: "date-time", description: "Cookie expiry (30 days, renewed while active)." },
      },
    },
    InvalidSession: {
      type: "object",
      description: "The token is still present but its user was deleted or changed password: sign in again.",
      required: ["expires", "invalid"],
      properties: { expires: { type: "string", format: "date-time" }, invalid: { type: "boolean", const: true } },
    },
    AuthProvider: {
      type: "object",
      required: ["id", "name", "type", "signinUrl", "callbackUrl"],
      properties: {
        id: { type: "string", examples: ["credentials", "github"] },
        name: { type: "string", examples: ["Username", "GitHub"] },
        type: { type: "string", enum: ["credentials", "oauth"] },
        signinUrl: { type: "string", format: "uri" },
        callbackUrl: { type: "string", format: "uri" },
      },
    },
    AuthProviders: {
      type: "object",
      description: "Enabled sign-in providers keyed by id. OAuth providers appear only when their client id and secret are configured.",
      additionalProperties: schemaRef("AuthProvider"),
    },
  };
}
