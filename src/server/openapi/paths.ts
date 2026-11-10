import {
  SAMPLE_IDS,
  sampleCategories,
  sampleFeatureCollection,
  sampleLayerList,
  sampleRecentUploads,
  sampleSession,
  sampleTerrainJobDone,
  sampleTerrainLayerJson,
  sampleTerrainLayers,
  sampleUploadSession,
  sampleVectorJobDone,
} from "./examples";
import {
  errorResponse,
  formatSize,
  headerRef,
  jsonContent,
  jsonResponse,
  parameterRef,
  responseRef,
  schemaRef,
  validationResponse,
} from "./helpers";
import { ICON_FILE_PATTERN } from "./schemas";
import type { OpenApiSettings } from "./settings";
import type { OperationObject, PathItemObject, ResponseObject, ResponsesObject, SchemaObject } from "./types";

const ANY_ROLE = "**Role:** any signed-in user (`admin`, `engineering`).";
const ADMIN_ONLY = "**Role:** `admin`.";

const binary: SchemaObject = { type: "string", format: "binary" };

/** Errors every cookie-authenticated `/geodata/*` operation can return. */
function authErrors(adminOnly: boolean): ResponsesObject {
  return {
    "401": responseRef("Unauthenticated"),
    ...(adminOnly ? { "403": responseRef("Forbidden") } : {}),
    "500": responseRef("ServerError"),
  };
}

/** 429 of the per-user upload rate limits. */
function rateLimited(name: string, perMinute: number): ResponseObject {
  return errorResponse(
    `Rate limit \`${name}\` (${perMinute} requests per minute per user) exceeded. Retry after \`Retry-After\` seconds.`,
    { rateLimited: "Too Many Attempts." },
    {
      "Retry-After": headerRef("RetryAfter"),
      "X-RateLimit-Limit": headerRef("RateLimitLimit"),
      "X-RateLimit-Remaining": headerRef("RateLimitRemaining"),
    },
  );
}

/** 422 that is either a field validation error or a plain `{ message }` business-rule error. */
function unprocessable(
  description: string,
  fieldErrors: Record<string, { summary?: string; errors: Record<string, string[]> }>,
  messages: Record<string, string> = {},
): ResponseObject {
  const validation = validationResponse(fieldErrors);
  const examples = {
    ...validation.content!["application/json"].examples,
    ...Object.fromEntries(Object.entries(messages).map(([name, message]) => [name, { summary: message, value: { message } }])),
  };
  return jsonResponse(description, { anyOf: [schemaRef("ValidationError"), schemaRef("Error")] }, examples);
}

const csrf = { "419": responseRef("CsrfMismatch") };

const tileCacheHeader = {
  "Cache-Control": { description: "`public, max-age=604800` (7 days).", schema: { type: "string" } },
} as const;

export function buildPaths(settings: OpenApiSettings): Record<string, PathItemObject> {
  const limits = settings.rateLimits;
  const chunkSize = formatSize(settings.chunkBytes);
  const session = sampleUploadSession(settings);
  const uploadStart = rateLimited("upload-start", limits["upload-start"]);
  const uploadStatus = rateLimited("upload-status", limits["upload-status"]);

  // ------------------------------------------------------------------ Auth
  const getCsrfToken: OperationObject = {
    tags: ["Auth"],
    operationId: "getCsrfToken",
    summary: "Get a CSRF token for sign-in / sign-out",
    description:
      "Step 1 of the credentials sign-in. Returns the token and sets the `next-auth.csrf-token` cookie; send both " +
      "(token in the form body, cookie in `Cookie`) to `POST /api/auth/callback/credentials` or `POST /api/auth/signout`.",
    security: [],
    responses: {
      "200": jsonResponse("CSRF token.", schemaRef("CsrfTokenResponse"), undefined, {
        "Set-Cookie": headerRef("CsrfCookie"),
      }),
    },
  };

  const signIn: OperationObject = {
    tags: ["Auth"],
    operationId: "signInWithCredentials",
    summary: "Sign in with username / email and password",
    description:
      "Step 2 of the credentials sign-in (NextAuth credentials provider). Send the form with the cookies from " +
      "`GET /api/auth/csrf`; on success the response sets the JWT session cookie (`next-auth.session-token`, " +
      "`__Secure-next-auth.session-token` over HTTPS) that authenticates every other request.\n\n" +
      `Throttled: ${limits.login} attempts per minute per IP and ${limits["login-identifier"]} failed attempts per ` +
      "identifier + IP; a throttled attempt answers 401 like wrong credentials, with the wait time in the message.\n\n" +
      "Note NextAuth's quirk: a missing or mismatched `csrfToken` answers **200** with `url` ending in " +
      "`/api/auth/signin?csrf=true` and no session cookie, so check for the cookie (or call `GET /api/auth/session`).",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/x-www-form-urlencoded": {
          schema: schemaRef("CredentialsSignInRequest"),
          examples: {
            admin: {
              summary: "Sign in by username",
              value: { csrfToken: "<token from /api/auth/csrf>", id_user: "admin", password: "<password>", remember: "false", json: "true" },
            },
          },
        },
      },
    },
    responses: {
      "200": jsonResponse(
        "Signed in (session cookie set), or CSRF check failed (no cookie, `url` ends in `?csrf=true`).",
        schemaRef("AuthUrlResponse"),
        {
          signedIn: { summary: "Signed in", value: { url: "http://localhost:3000" } },
          csrfMismatch: { summary: "Missing / wrong csrfToken", value: { url: "http://localhost:3000/api/auth/signin?csrf=true" } },
        },
        { "Set-Cookie": headerRef("SessionCookie") },
      ),
      "302": {
        description: "Without `json=true`: browser-style redirect (to `callbackUrl` on success, else to the login page).",
        headers: { Location: { schema: { type: "string" } } },
      },
      "401": jsonResponse("Wrong credentials or too many attempts; the message is in the `error` query parameter of `url`.", schemaRef("AuthUrlResponse"), {
        failed: {
          summary: "These credentials do not match our records.",
          value: { url: "http://localhost:3000/api/auth/error?error=These%20credentials%20do%20not%20match%20our%20records." },
        },
        throttled: {
          summary: "Too many login attempts. Please try again in 42 seconds.",
          value: { url: "http://localhost:3000/api/auth/error?error=Too%20many%20login%20attempts.%20Please%20try%20again%20in%2042%20seconds." },
        },
      }),
    },
  };

  const getSession: OperationObject = {
    tags: ["Auth"],
    operationId: "getSession",
    summary: "Current session",
    description:
      "The signed-in user, `{}` without a session, or `{ expires, invalid: true }` when the token belongs to a deleted " +
      "user or predates a password change. Calling it also extends a session without \"Remember me\".",
    security: [],
    responses: {
      "200": jsonResponse(
        "Session (or an empty object).",
        { anyOf: [schemaRef("Session"), schemaRef("InvalidSession"), { type: "object", maxProperties: 0 }] },
        {
          signedIn: { summary: "Signed in", value: sampleSession },
          signedOut: { summary: "No session", value: {} },
          invalid: { summary: "Revoked session", value: { expires: sampleSession.expires, invalid: true } },
        },
      ),
    },
  };

  const getProviders: OperationObject = {
    tags: ["Auth"],
    operationId: "getAuthProviders",
    summary: "Enabled sign-in providers",
    security: [],
    responses: {
      "200": jsonResponse("Providers keyed by id.", schemaRef("AuthProviders"), {
        credentialsOnly: {
          summary: "No OAuth provider configured",
          value: {
            credentials: {
              id: "credentials",
              name: "Username",
              type: "credentials",
              signinUrl: "http://localhost:3000/api/auth/signin/credentials",
              callbackUrl: "http://localhost:3000/api/auth/callback/credentials",
            },
          },
        },
      }),
    },
  };

  const signOut: OperationObject = {
    tags: ["Auth"],
    operationId: "signOut",
    summary: "Sign out",
    description:
      "Clears the session cookie (`Max-Age=0`). Sessions are stateless JWTs, so a copied token stays valid until it " +
      "expires unless the password is changed. A missing or wrong `csrfToken` signs nothing out and points `url` to " +
      "`/api/auth/signout?csrf=true` (302 without `json=true`).",
    security: [],
    requestBody: {
      required: true,
      content: {
        "application/x-www-form-urlencoded": {
          schema: schemaRef("SignOutRequest"),
          example: { csrfToken: "<token from /api/auth/csrf>", json: "true" },
        },
      },
    },
    responses: {
      "200": jsonResponse("Signed out.", schemaRef("AuthUrlResponse"), {
        signedOut: { summary: "Signed out", value: { url: "http://localhost:3000" } },
      }),
      "302": { description: "Without `json=true`: redirect.", headers: { Location: { schema: { type: "string" } } } },
    },
  };

  // ------------------------------------------------------------------ Layers
  const listLayers: OperationObject = {
    tags: ["Layers"],
    operationId: "listLayers",
    summary: "Published layers grouped by category",
    description:
      "Published terrain and vector layers for the map's layer panel, grouped by layer category (category sort order, " +
      "newest layer first). Layers without a category are listed under the `other` category; categories without a " +
      `matching layer are left out.\n\n${ANY_ROLE}`,
    parameters: [
      {
        name: "search",
        in: "query",
        description: "Case-insensitive substring of the layer name (trimmed; empty = no filter).",
        schema: { type: "string" },
        example: "dem",
      },
      {
        name: "month_year",
        in: "query",
        description:
          "Only layers uploaded in this month (UTC), as `YYYY-MM`. Other formats are ignored; an impossible month such as " +
          "`2026-13` matches nothing.",
        schema: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$" },
        example: "2026-11",
      },
    ],
    responses: {
      "200": jsonResponse("Layers by category.", schemaRef("LayerListResponse"), {
        layers: { summary: "One terrain and one vector layer", value: sampleLayerList },
        empty: { summary: "Nothing matches", value: { success: true, categories: [] } },
      }),
      ...authErrors(false),
    },
  };

  const listTerrainLayers: OperationObject = {
    tags: ["Layers"],
    operationId: "listTerrainLayers",
    summary: "Published terrain layers",
    description: `Newest published terrain layers, for the comparison-terrain pickers of the Cut & Fill and Profile tools.\n\n${ANY_ROLE}`,
    parameters: [
      {
        name: "limit",
        in: "query",
        description: "Maximum number of layers. Clamped to 1–100; a non-numeric value counts as 1.",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
      },
    ],
    responses: {
      "200": jsonResponse("Terrain layers.", schemaRef("TerrainLayerListResponse"), {
        layers: { summary: "One terrain layer", value: sampleTerrainLayers },
      }),
      ...authErrors(false),
    },
  };

  const listRecentUploads: OperationObject = {
    tags: ["Layers"],
    operationId: "listRecentUploads",
    summary: "Latest conversion jobs",
    description: `The 10 newest conversion jobs (any uploader), for the Data panel.\n\n${ADMIN_ONLY}`,
    responses: {
      "200": jsonResponse("Recent jobs.", schemaRef("RecentUploadsResponse"), {
        jobs: { summary: "A running and a finished job", value: sampleRecentUploads },
      }),
      ...authErrors(true),
    },
  };

  const listLayerCategories: OperationObject = {
    tags: ["Layers"],
    operationId: "listLayerCategories",
    summary: "Layer categories",
    description: `All layer categories in sort order (for the upload form's category picker).\n\n${ANY_ROLE}`,
    responses: {
      "200": jsonResponse("Categories.", schemaRef("CategoryListResponse"), {
        categories: { summary: "Default categories", value: { success: true, categories: sampleCategories } },
      }),
      ...authErrors(false),
    },
  };

  const deleteLayer: OperationObject = {
    tags: ["Layers"],
    operationId: "deleteLayer",
    summary: "Delete a layer",
    description:
      "Deletes the layer with its conversion job, logs, upload sessions and source files, then queues the removal of its " +
      "tiles, files and PostGIS table. Refused (409) while the conversion is queued or processing, unless the job has " +
      `been idle for more than 3 hours. Cannot be undone.\n\n${ADMIN_ONLY}`,
    parameters: [parameterRef("LayerUlid")],
    responses: {
      "200": jsonResponse("Deleted.", schemaRef("LayerDeletedResponse"), {
        deleted: { summary: "Layer deleted.", value: { success: true, message: "Layer deleted." } },
      }),
      "404": responseRef("NotFound"),
      "409": jsonResponse("The layer's conversion is still running.", schemaRef("LayerBusyResponse"), {
        busy: {
          summary: "Still processing",
          value: {
            success: false,
            message: "This layer is still being processed. Wait until its conversion finishes or fails before deleting it.",
          },
        },
      }),
      ...csrf,
      ...authErrors(true),
    },
  };

  const getCategoryIcon: OperationObject = {
    tags: ["Layers"],
    operationId: "getCategoryIcon",
    summary: "Layer category icon",
    description:
      "Uploaded category icon referenced by `icon_url`. Only `layer-categories/<name>.png|webp` files are served.\n\n" +
      ANY_ROLE,
    parameters: [
      {
        name: "icon",
        in: "path",
        required: true,
        description: "Icon file name.",
        schema: { type: "string", pattern: ICON_FILE_PATTERN },
        example: "q8ZtR2mXk4Wv.webp",
      },
    ],
    responses: {
      "200": {
        description: "The icon.",
        headers: {
          "Cache-Control": { description: "`private, max-age=86400`.", schema: { type: "string" } },
          "X-Content-Type-Options": { schema: { type: "string", const: "nosniff" } },
        },
        content: { "image/png": { schema: binary }, "image/webp": { schema: binary } },
      },
      "404": responseRef("NotFound"),
      ...authErrors(false),
    },
  };

  // ------------------------------------------------------------------ Tiles
  const getTerrainLayerJson: OperationObject = {
    tags: ["Tiles"],
    operationId: "getTerrainLayerJson",
    summary: "Terrain tileset metadata (layer.json)",
    description:
      "Quantized-mesh `layer.json` of a published terrain layer: the entry point of `CesiumTerrainProvider.fromUrl(tileset_url)`. " +
      `Tile URL templates get a \`terrain_revision\` parameter appended to bust stale browser caches.\n\n${ANY_ROLE}`,
    parameters: [parameterRef("TerrainLayerId")],
    responses: {
      "200": {
        description: "Tileset metadata.",
        headers: { "Cache-Control": { description: "`no-cache`.", schema: { type: "string" } } },
        content: jsonContent(schemaRef("TerrainLayerJson"), { layerJson: { summary: "Cesium Terrain Builder output", value: sampleTerrainLayerJson } }),
      },
      "404": {
        description:
          "Unknown or unpublished layer (JSON), or a published layer whose `layer.json` is missing on disk (`text/plain` \"Metadata not found\").",
        content: {
          "application/json": { schema: schemaRef("Error"), example: { message: "Not Found" } },
          "text/plain": { schema: { type: "string" }, example: "Metadata not found" },
        },
      },
      ...authErrors(false),
    },
  };

  const getTerrainTile: OperationObject = {
    tags: ["Tiles"],
    operationId: "getTerrainTile",
    summary: "Terrain tile (quantized-mesh)",
    description:
      "One quantized-mesh-1.0 tile (TMS scheme, EPSG:4326) of a published terrain layer. Tiles are stored gzip-compressed " +
      "and sent decompressed (the HTTP layer may re-compress them). Zoom levels follow the layer's `available` ranges " +
      `(conversion range ${settings.terrainMinZoom}–${settings.terrainMaxZoom}).\n\n${ANY_ROLE}`,
    parameters: [
      parameterRef("TerrainLayerId"),
      parameterRef("TileZ"),
      parameterRef("TileX"),
      parameterRef("TileY"),
      { name: "v", in: "query", description: "Tileset version from `layer.json` (cache buster, ignored).", schema: { type: "string" } },
      { name: "terrain_revision", in: "query", description: "Tile revision (cache buster, ignored).", schema: { type: "string" } },
    ],
    responses: {
      "200": {
        description: "Tile bytes.",
        headers: tileCacheHeader,
        content: { "application/octet-stream": { schema: binary } },
      },
      "404": {
        description:
          "Unknown / unpublished layer or malformed path (JSON), or a tile outside the dataset (`text/plain` \"Terrain tile not found\", `Cache-Control: no-store`).",
        content: {
          "application/json": { schema: schemaRef("Error"), example: { message: "Not Found" } },
          "text/plain": { schema: { type: "string" }, example: "Terrain tile not found" },
        },
      },
      ...authErrors(false),
    },
  };

  const getOrthoTile: OperationObject = {
    tags: ["Tiles"],
    operationId: "getOrthoTile",
    summary: "Orthophoto tile (XYZ PNG)",
    description:
      "One 256 px XYZ (Web Mercator) PNG tile of a published terrain layer's orthophoto, as templated by " +
      `\`terrain_detail.ortho_tiles_url\`. Available zooms: \`ortho_min_zoom\`–\`ortho_max_zoom\`.\n\n${ANY_ROLE}`,
    parameters: [parameterRef("TerrainLayerId"), parameterRef("TileZ"), parameterRef("TileX"), parameterRef("TileY")],
    responses: {
      "200": { description: "PNG tile.", headers: tileCacheHeader, content: { "image/png": { schema: binary } } },
      "404": {
        description: "Unknown / unpublished layer or malformed path (JSON), or a tile outside the orthophoto (empty body).",
        content: {
          "application/json": { schema: schemaRef("Error"), example: { message: "Not Found" } },
          "text/plain": { schema: { type: "string", maxLength: 0 } },
        },
      },
      ...authErrors(false),
    },
  };

  // ------------------------------------------------------------------ Vector
  const getVectorGeoJson: OperationObject = {
    tags: ["Vector"],
    operationId: "getVectorGeoJson",
    summary: "Vector layer as GeoJSON",
    description:
      "Streams every feature of a published vector layer (its PostGIS table) as one GeoJSON FeatureCollection in WGS84. " +
      "Large layers produce large responses; the body is streamed, so read it incrementally. A published layer without " +
      `a vector table (e.g. a terrain layer) returns an empty collection.\n\n${ANY_ROLE}`,
    parameters: [
      {
        name: "layer",
        in: "path",
        required: true,
        description: "Layer id.",
        schema: schemaRef("Ulid"),
        example: SAMPLE_IDS.vectorLayer,
      },
    ],
    responses: {
      "200": {
        description: "Feature collection.",
        headers: { "Cache-Control": { description: "`no-cache` (streamed responses).", schema: { type: "string" } } },
        content: jsonContent(schemaRef("FeatureCollection"), {
          features: { summary: "Two features", value: sampleFeatureCollection },
          empty: { summary: "No vector table", value: { type: "FeatureCollection", features: [] } },
        }),
      },
      "400": errorResponse("The layer's table name failed the safety check (corrupt layer metadata).", {
        invalidTable: "Invalid table name pattern.",
      }),
      "404": responseRef("NotFound"),
      ...authErrors(false),
    },
  };

  // ------------------------------------------------------------------ Upload
  const startUploadSession: OperationObject = {
    tags: ["Upload"],
    operationId: "startUploadSession",
    summary: "Start (or resume) an upload session",
    description:
      `Step 1 of the upload. Creates a session for one file, to be sent in ${chunkSize} chunks. With a \`requestId\` the call ` +
      "is idempotent: repeating it returns the existing session (still 201), so a client that lost the response can " +
      "retry safely.\n\n" +
      `Quotas per user: at most ${settings.maxActiveSessions} active sessions (uploading or queued) and ` +
      `${settings.maxInflightMb} MB in flight; the server also keeps ${settings.minFreeDiskMb} MB of disk free after reserving twice ` +
      `the file size.\n\nRate limit \`upload-start\`: ${limits["upload-start"]}/min. ${ADMIN_ONLY}`,
    requestBody: {
      required: true,
      description: "JSON (form-encoded bodies are accepted too).",
      content: jsonContent(schemaRef("StartUploadSessionRequest"), {
        dem: { summary: "A DEM GeoTIFF", value: { fileName: "DEM_120722.tif", fileSize: 5_242_880, requestId: SAMPLE_IDS.request } },
      }),
    },
    responses: {
      "201": jsonResponse("Session created, or the existing session of this `requestId`.", schemaRef("UploadSessionResponse"), {
        created: { summary: "New session", value: { success: true, session } },
      }),
      "400": responseRef("MalformedJson"),
      "409": errorResponse("`requestId` already used for a different file.", {
        requestIdReused: "Upload request ID was used for a different file.",
      }),
      "410": errorResponse("The session of this `requestId` expired; use a new `requestId`.", { expired: "Upload expired." }),
      "413": errorResponse(`The user's active uploads would exceed ${settings.maxInflightMb} MB.`, {
        quota: "Your active uploads exceed the storage quota.",
      }),
      "422": unprocessable("Invalid input.", {
        required: {
          summary: "Missing fields",
          errors: { fileName: ["The file name field is required."], fileSize: ["The file size field is required."] },
        },
        unsupported: { errors: { fileName: ["Unsupported format or unsafe file name."] } },
        tooLarge: {
          errors: { fileSize: [`The file size field must not be greater than ${settings.maxUploadMb * 1024 * 1024}.`] },
        },
        badRequestId: { errors: { requestId: ["The request id field must be a valid UUID."] } },
      }),
      "429": {
        description:
          `Rate limit \`upload-start\` (${limits["upload-start"]}/min, with \`Retry-After\`), or already ` +
          `${settings.maxActiveSessions} active sessions (no \`Retry-After\`: cancel or finish an upload first).`,
        headers: {
          "Retry-After": headerRef("RetryAfter"),
          "X-RateLimit-Limit": headerRef("RateLimitLimit"),
          "X-RateLimit-Remaining": headerRef("RateLimitRemaining"),
        },
        content: jsonContent(schemaRef("Error"), {
          rateLimited: { summary: "Too Many Attempts.", value: { message: "Too Many Attempts." } },
          tooManySessions: {
            summary: "Too many active uploads.",
            value: { message: "Too many active uploads. Cancel an upload before starting another." },
          },
        }),
      },
      "507": responseRef("InsufficientStorage"),
      ...csrf,
      ...authErrors(true),
    },
  };

  const getUploadSession: OperationObject = {
    tags: ["Upload"],
    operationId: "getUploadSession",
    summary: "Upload session state (resume)",
    description:
      "The session's state, used to resume an interrupted upload: send only the chunk indexes missing from `chunks`. " +
      `Only the session's owner can read it.\n\nRate limit \`upload-status\`: ${limits["upload-status"]}/min. ${ADMIN_ONLY}`,
    parameters: [parameterRef("UploadIdentifier")],
    responses: {
      "200": jsonResponse("Session.", schemaRef("UploadSessionResponse"), { session: { summary: "Uploading", value: { success: true, session } } }, {
        "Cache-Control": { description: "`no-store`.", schema: { type: "string" } },
      }),
      "404": responseRef("NotFound"),
      "410": errorResponse("The unfinished session expired.", { expired: "Upload expired." }),
      "429": uploadStatus,
      ...authErrors(true),
    },
  };

  const cancelUploadSession: OperationObject = {
    tags: ["Upload"],
    operationId: "cancelUploadSession",
    summary: "Cancel an upload",
    description:
      "Cancels a session that was not submitted for processing yet and deletes its stored chunks. Cancelling a cancelled " +
      `session succeeds again.\n\nRate limit \`upload-start\`: ${limits["upload-start"]}/min. ${ADMIN_ONLY}`,
    parameters: [parameterRef("UploadIdentifier")],
    responses: {
      "200": jsonResponse("Cancelled.", schemaRef("Success"), { cancelled: { summary: "Cancelled", value: { success: true } } }),
      "404": responseRef("NotFound"),
      "409": errorResponse("Already submitted for processing.", { processing: "Processing has already started." }),
      "429": uploadStart,
      ...csrf,
      ...authErrors(true),
    },
  };

  const uploadChunk: OperationObject = {
    tags: ["Upload"],
    operationId: "uploadChunk",
    summary: "Upload one chunk",
    description:
      `Step 2 of the upload. Send each chunk (\`chunkSize\` = ${chunkSize}, the last one holds the remainder) with its ` +
      "SHA-256. Chunks may arrive in any order and in parallel; re-sending a stored chunk with the same checksum is a " +
      "no-op, a different one is a 409. Each stored chunk extends the session's expiry.\n\n" +
      `Rate limit \`upload-chunks\`: ${limits["upload-chunks"]}/min. ${ADMIN_ONLY}`,
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: schemaRef("UploadChunkRequest"),
          encoding: { file: { contentType: "application/octet-stream" } },
        },
      },
    },
    responses: {
      "200": jsonResponse("Chunk stored.", schemaRef("Success"), { stored: { summary: "Stored", value: { success: true } } }),
      "404": responseRef("NotFound"),
      "409": errorResponse("The session no longer accepts chunks, or another chunk is stored at this index.", {
        notWritable: "This upload is no longer writable.",
        differentChunk: "A different chunk already exists at this index.",
      }),
      "410": errorResponse("The session expired.", { expired: "This upload expired. Please select the file again." }),
      "422": unprocessable(
        "Invalid input, or the chunk does not fit the session.",
        {
          required: {
            summary: "Missing fields",
            errors: {
              file: ["The file field is required."],
              identifier: ["The identifier field is required."],
              chunkIndex: ["The chunk index field is required."],
              checksum: ["The checksum field is required."],
            },
          },
          tooLarge: { errors: { file: [`The file field must not be greater than ${Math.ceil(settings.chunkBytes / 1024)} kilobytes.`] } },
          badChecksum: { errors: { checksum: ["The checksum field format is invalid."] } },
        },
        {
          outOfRange: "Chunk index is out of range.",
          wrongSize: "Chunk size does not match the upload session.",
          checksumMismatch: "Chunk checksum mismatch.",
        },
      ),
      "429": rateLimited("upload-chunks", limits["upload-chunks"]),
      "507": responseRef("InsufficientStorage"),
      ...csrf,
      ...authErrors(true),
    },
  };

  /** assemble-raster and assemble-vector share everything but the identifiers. */
  function assembleOperation(kind: "raster" | "vector"): OperationObject {
    const raster = kind === "raster";
    return {
      tags: ["Upload"],
      operationId: raster ? "assembleRasterUpload" : "assembleVectorUpload",
      summary: raster ? "Submit a terrain upload (DEM + optional orthophoto)" : "Submit a vector upload",
      description:
        (raster
          ? "Step 3 for terrain: submits a completed DEM GeoTIFF session (and optionally an orthophoto GeoTIFF session). " +
            "The worker assembles and verifies the files, then builds quantized-mesh terrain tiles and XYZ orthophoto tiles."
          : "Step 3 for vector data: submits a completed GeoJSON, zipped Shapefile (exactly one dataset with .shp, .shx, " +
            ".dbf and .prj), DXF, DWG or Surpac STR session. The worker verifies the file and imports it into PostGIS. " +
            "`sourceEpsg` is required for DXF, DWG and STR.") +
        "\n\nCreates the layer (status `processing`) and a queued conversion job, and answers 202 with the job id to poll " +
        "(step 4). Idempotent: repeating the request with the same parameters returns the same `job_id`; different " +
        "parameters for an already submitted session are a 409. Verification failures (file signature, archive limits: " +
        `${settings.zipMaxEntries} entries, ${settings.zipMaxUncompressedMb} MB uncompressed, ratio ${settings.zipMaxRatio}:1) ` +
        "surface later as a `failed` job.\n\n" +
        `Rate limit \`upload-start\`: ${limits["upload-start"]}/min. ${ADMIN_ONLY}`,
      requestBody: {
        required: true,
        description: "JSON (form-encoded bodies are accepted too).",
        content: jsonContent(
          schemaRef(raster ? "AssembleRasterRequest" : "AssembleVectorRequest"),
          raster
            ? {
                demWithOrtho: {
                  summary: "DEM with orthophoto",
                  value: {
                    layerName: "DEM 12-07-2022",
                    demIdentifier: SAMPLE_IDS.demUpload,
                    orthoIdentifier: SAMPLE_IDS.orthoUpload,
                    acquisitionDate: "2022-07-12",
                    layer_category_id: SAMPLE_IDS.categoryTerrain,
                  },
                },
                demOnly: { summary: "DEM only", value: { layerName: "DEM 12-07-2022", demIdentifier: SAMPLE_IDS.demUpload } },
              }
            : {
                str: {
                  summary: "Surpac STR (needs sourceEpsg)",
                  value: {
                    layerName: "Pit_design A",
                    identifier: SAMPLE_IDS.vectorUpload,
                    sourceEpsg: settings.defaultEpsg,
                    acquisitionDate: null,
                    layer_category_id: SAMPLE_IDS.categoryDesign,
                  },
                },
                geojson: { summary: "GeoJSON", value: { layerName: "Boundary 2026", identifier: SAMPLE_IDS.vectorUpload } },
              },
        ),
      },
      responses: {
        "202": jsonResponse("Queued.", schemaRef("UploadQueuedResponse"), {
          queued: {
            summary: "Queued",
            value: {
              success: true,
              message: "Upload queued for verification and processing.",
              job_id: raster ? SAMPLE_IDS.terrainJob : SAMPLE_IDS.vectorJob,
            },
          },
        }),
        "400": responseRef("MalformedJson"),
        "404": responseRef("NotFound"),
        "409": errorResponse("A session is incomplete, no longer writable, or was submitted with different parameters.", {
          incomplete: "Upload is incomplete. Resume the missing chunks.",
          missingChunk: "A required chunk is missing.",
          notWritable: "This upload is no longer writable.",
          differentParameters: "Upload was already submitted with different parameters.",
        }),
        "410": errorResponse("A session expired.", { expired: "This upload expired. Please select the file again." }),
        "422": unprocessable(
          "Invalid input, or the files do not fit this workflow.",
          raster
            ? {
                required: {
                  summary: "Missing fields",
                  errors: { layerName: ["The layer name field is required."], demIdentifier: ["The dem identifier field is required."] },
                },
                sameSession: { errors: { orthoIdentifier: ["The ortho identifier field and dem identifier must be different."] } },
                badDate: { errors: { acquisitionDate: ["The acquisition date field must match the format Y-m-d."] } },
              }
            : {
                required: {
                  summary: "Missing fields",
                  errors: { layerName: ["The layer name field is required."], identifier: ["The identifier field is required."] },
                },
                badEpsg: { errors: { sourceEpsg: ["The source epsg field format is invalid."] } },
                badCategory: { errors: { layer_category_id: ["The selected layer category id is invalid."] } },
              },
          raster
            ? { wrongFormat: "File format does not match this upload workflow." }
            : { wrongFormat: "File format does not match this upload workflow.", epsgRequired: "Source EPSG is required for CAD/STR files." },
        ),
        "429": uploadStart,
        "503": errorResponse("The job could not be queued (it is marked failed); try again later.", {
          queueDown: "The upload could not be queued for processing. Please try again later.",
        }),
        ...csrf,
        ...authErrors(true),
      },
    };
  }

  const getUploadStatus: OperationObject = {
    tags: ["Upload"],
    operationId: "getUploadStatus",
    summary: "Conversion job status (polling)",
    description:
      "Step 4 of the upload: poll until `status` is `done` (the response then includes the new layer and source file) or " +
      `\`failed\`. Only the uploader of the job's layer can read it; other jobs are a 404.\n\nRate limit \`upload-status\`: ` +
      `${limits["upload-status"]}/min. ${ADMIN_ONLY}`,
    parameters: [parameterRef("JobId")],
    responses: {
      "200": jsonResponse("Job status.", schemaRef("UploadStatusResponse"), {
        processing: {
          summary: "Processing",
          value: { success: true, status: "processing", error_message: null, finished_at: null },
        },
        doneTerrain: { summary: "Done (terrain)", value: sampleTerrainJobDone },
        doneVector: { summary: "Done (vector)", value: sampleVectorJobDone },
        failed: {
          summary: "Failed",
          value: {
            success: true,
            status: "failed",
            error_message: "File processing failed. Please contact an administrator with the job ID.",
            finished_at: "2026-11-09T16:58:02+00:00",
          },
        },
      }),
      "404": responseRef("NotFound"),
      "429": uploadStatus,
      ...authErrors(true),
    },
  };

  // ------------------------------------------------------------------ Health & docs
  const healthCheck: OperationObject = {
    tags: ["Health"],
    operationId: "healthCheck",
    summary: "Health check",
    description: "200 when the app can reach the database, 503 otherwise. No authentication; suitable for load balancers.",
    security: [],
    responses: {
      "200": jsonResponse("Up.", schemaRef("HealthStatus"), { up: { summary: "Up", value: { status: "up" } } }),
      "503": jsonResponse("Database unreachable.", schemaRef("HealthStatus"), { down: { summary: "Down", value: { status: "down" } } }),
    },
  };

  const getOpenApiDocument: OperationObject = {
    tags: ["Docs"],
    operationId: "getOpenApiDocument",
    summary: "This OpenAPI document",
    description: `The OpenAPI 3.1 document rendered at \`/api/api-docs\`. Limits in it follow the server's configuration.\n\n${ANY_ROLE}`,
    responses: {
      "200": {
        description: "OpenAPI document.",
        headers: { "Cache-Control": { description: "`no-store`.", schema: { type: "string" } } },
        content: { "application/json": { schema: { type: "object", required: ["openapi", "info", "paths"] } } },
      },
      "307": {
        description: "No session cookie: redirect to the login page (`/login?redirect=...`).",
        headers: { Location: { schema: { type: "string" } } },
      },
      ...authErrors(false),
    },
  };

  return {
    "/api/auth/csrf": { get: getCsrfToken },
    "/api/auth/callback/credentials": { post: signIn },
    "/api/auth/session": { get: getSession },
    "/api/auth/providers": { get: getProviders },
    "/api/auth/signout": { post: signOut },

    "/geodata/layers/all": { get: listLayers },
    "/geodata/layers/terrain": { get: listTerrainLayers },
    "/geodata/layers/recent-uploads": { get: listRecentUploads },
    "/geodata/layers/{layer}": { delete: deleteLayer },
    "/geodata/layer-categories": { get: listLayerCategories },
    "/geodata/icons/layer-categories/{icon}": { get: getCategoryIcon },

    "/geodata/terrain/{layerId}/layer.json": { get: getTerrainLayerJson },
    "/geodata/terrain/{layerId}/{z}/{x}/{y}.terrain": { get: getTerrainTile },
    "/geodata/ortho/{layerId}_ortho/{z}/{x}/{y}.png": { get: getOrthoTile },

    "/geodata/vector/{layer}/data.json": { get: getVectorGeoJson },

    "/geodata/upload/sessions": { post: startUploadSession },
    "/geodata/upload/sessions/{identifier}": { get: getUploadSession, delete: cancelUploadSession },
    "/geodata/upload/chunk": { post: uploadChunk },
    "/geodata/upload/assemble-raster": { post: assembleOperation("raster") },
    "/geodata/upload/assemble-vector": { post: assembleOperation("vector") },
    "/geodata/upload/status/{job}": { get: getUploadStatus },

    "/up": { get: healthCheck },
    "/api/api-docs/openapi.json": { get: getOpenApiDocument },
  };
}
