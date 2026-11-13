// Plain server module (no "server-only" / Next.js imports): scripts/export-openapi.ts runs it under tsx.
import { errorResponse, formatSize, jsonResponse, pathParameter, schemaRef } from "./helpers";
import { buildPaths } from "./paths";
import { buildSchemas, CROCKFORD_ULID_PATTERN, ULID_PATTERN } from "./schemas";
import { currentOpenApiSettings, type OpenApiSettings } from "./settings";
import { SAMPLE_IDS } from "./examples";
import type { ComponentsObject, OpenApiDocument, TagObject } from "./types";

/** Version of the HTTP API contract (bump when an endpoint changes incompatibly). */
export const API_VERSION = "1.0.0";

const TAGS: TagObject[] = [
  { name: "Auth", description: "NextAuth endpoints for signing in API clients with username / email and password." },
  { name: "Mobile", description: "Bearer tokens for mobile apps and other non-browser clients." },
  { name: "Layers", description: "Published layer lists, layer categories and their icons, layer deletion." },
  { name: "Tiles", description: "Terrain (quantized-mesh) and orthophoto (XYZ PNG) tiles of published layers, as loaded by CesiumJS." },
  { name: "Vector", description: "Vector layers as GeoJSON." },
  { name: "Upload", description: "Chunked, resumable geodata upload and conversion status (admin only)." },
  { name: "Health", description: "Liveness and database check." },
  { name: "Docs", description: "This OpenAPI document." },
];

function description(settings: OpenApiSettings): string {
  const limits = settings.rateLimits;
  const extensions = settings.allowedExtensions.map((extension) => `\`.${extension}\``).join(", ");

  return `HTTP API of **${settings.appName}**: published layer lists, terrain / orthophoto tiles, vector GeoJSON and the chunked geodata upload used by the 3D map. Request and response bodies are JSON unless an operation says otherwise.

The dashboard's management actions (layer renaming / archiving, layer categories, users, profile) are Next.js Server Actions, not REST endpoints, and are not part of this document.

## Authentication

Every \`/geodata/*\` endpoint needs a signed-in user. Sessions are NextAuth v4 JWTs kept in an HTTP-only cookie: \`next-auth.session-token\` (\`__Secure-next-auth.session-token\` over HTTPS). On this page your browser sends that cookie by itself, so **Try it out** runs as you.

API clients sign in with the credentials flow and keep a cookie jar:

1. \`GET /api/auth/csrf\` → \`{ "csrfToken": "..." }\` plus a \`next-auth.csrf-token\` cookie.
2. \`POST /api/auth/callback/credentials\` as \`application/x-www-form-urlencoded\` with \`csrfToken\`, \`id_user\` (username or email), \`password\`, \`remember=true|false\` and \`json=true\`. Success is \`200 { "url": ... }\` with the session cookie; wrong credentials are \`401\`.
3. Send the cookie with every request. \`GET /api/auth/session\` shows the signed-in user; \`POST /api/auth/signout\` (with a fresh \`csrfToken\`) clears the cookie.

\`\`\`bash
curl -c jar -b jar http://localhost:3000/api/auth/csrf
curl -c jar -b jar http://localhost:3000/api/auth/callback/credentials \\
  --data-urlencode csrfToken=<token> --data-urlencode id_user=<username> \\
  --data-urlencode password=<password> -d remember=false -d json=true
curl -b jar http://localhost:3000/geodata/layers/all
\`\`\`

Without "Remember me" a session ends after ${settings.sessionLifetimeMinutes} idle minutes; with it, after 30 days. Deleting a user or changing their password revokes their sessions. Sign-in is throttled (${limits.login} attempts per minute per IP, ${limits["login-identifier"]} failed attempts per identifier and IP). OAuth sign-in (Discord, GitHub, Google, when configured) is a browser redirect flow and cannot be used by API clients.

### Mobile apps (Bearer token)

Mobile apps and other clients without a cookie jar use a Bearer token instead:

1. \`POST /api/mobile/token\` with JSON \`{ "id_user": "...", "password": "..." }\` → \`{ token_type: "Bearer", access_token, expires_in, expires_at, user }\`. Wrong credentials are \`422\`, throttling is \`429\` (same limits as the login form).
2. Send \`Authorization: Bearer <access_token>\` with every \`/geodata/*\` request (tiles included). When the header is present the session cookie is ignored, and an invalid token is \`401\`.
3. \`GET /api/mobile/user\` checks a stored token; \`POST /api/mobile/token/refresh\` returns a new one before the 30 days run out.
4. Clients that cannot add a header to tile requests (Cesium for Unity) get a signed terrain URL from \`GET /api/mobile/layers/{layerId}/terrain-url\`: its \`layer.json\` carries the signed \`t\` into every tile URL. It works for that layer only, for 12 hours.

\`\`\`bash
curl -X POST http://localhost:3000/api/mobile/token -H "Content-Type: application/json" \\
  -d '{"id_user":"<username>","password":"<password>"}'
curl -H "Authorization: Bearer <access_token>" http://localhost:3000/geodata/layers/all
\`\`\`

Tokens are stateless: signing out means discarding the token on the device. Deleting the user or changing their password revokes all of their tokens.

## Roles

| Role | Access |
| --- | --- |
| \`admin\` | Everything: layer lists, tiles, vector data, uploads, recent uploads, layer deletion. |
| \`engineering\` | Read-only: layer lists, categories, icons, tiles and vector data. |

A request without a valid session gets \`401 {"message":"Unauthenticated."}\`; a role without access gets \`403 {"message":"This action is unauthorized."}\`.

## CSRF protection

\`POST\` and \`DELETE\` requests to \`/geodata/*\` must come from the app's own origin: when the request has an \`Origin\` header it must equal the app origin (or \`APP_URL\`), otherwise \`Sec-Fetch-Site\` must be \`same-origin\` or \`none\`. Anything else gets \`419 {"message":"CSRF token mismatch."}\`. Non-browser clients that send neither header pass. The NextAuth endpoints use their own \`csrfToken\` instead (see Authentication).

## Errors

Errors of \`/geodata/*\` are JSON: \`{ "message": "..." }\`, and for validation failures (422) \`{ "message": "<first error>", "errors": { "<field>": ["..."] } }\`.

| Status | Meaning |
| --- | --- |
| 400 | Malformed JSON body |
| 401 / 403 | Not signed in / role not allowed |
| 404 | Not found, not published, or not yours (upload sessions and jobs) |
| 409 | Conflicting state (upload incomplete or already submitted, layer still processing) |
| 410 | Upload session expired |
| 413 | Upload quota exceeded (${settings.maxInflightMb} MB in flight per user) |
| 419 | CSRF check failed |
| 422 | Validation failed |
| 429 | Rate limit (\`Retry-After\` header) or too many active uploads |
| 500 | Unexpected error (the message is generic in production) |
| 503 | Upload could not be queued |
| 507 | Not enough free disk space |

Tile endpoints answer a missing tile with a plain-text (or empty) 404 instead of JSON.

## Upload flow

Uploads are admin-only and limited per user per minute: \`upload-start\` ${limits["upload-start"]} (start, cancel, assemble), \`upload-chunks\` ${limits["upload-chunks"]}, \`upload-status\` ${limits["upload-status"]} (session and job status).

1. **Start a session**: \`POST /geodata/upload/sessions\` with \`{ fileName, fileSize, requestId }\` → \`201 { session }\`. Use one random UUID \`requestId\` per file and reuse it on retries. Allowed extensions: ${extensions}; at most ${settings.maxUploadMb} MB per file, ${settings.maxActiveSessions} active sessions and ${settings.maxInflightMb} MB in flight per user. Unfinished sessions expire ${settings.sessionHours} hours after the last stored chunk.
2. **Send the chunks**: split the file into \`session.chunkSize\` (${formatSize(settings.chunkBytes)}) pieces and \`POST /geodata/upload/chunk\` each one as \`multipart/form-data\` with \`file\`, \`identifier\`, \`chunkIndex\` and \`checksum\` (lowercase hex SHA-256 of the chunk). Order does not matter and retries are safe. To resume, \`GET /geodata/upload/sessions/{identifier}\` and send the indexes missing from \`chunks\`.
3. **Assemble**: \`POST /geodata/upload/assemble-raster\` (DEM GeoTIFF plus an optional orthophoto session) or \`POST /geodata/upload/assemble-vector\` (GeoJSON, zipped Shapefile, DXF, DWG, Surpac STR) → \`202 { job_id }\`. The layer is created with status \`processing\`.
4. **Poll**: \`GET /geodata/upload/status/{job_id}\` until \`status\` is \`done\` (the response then contains the layer) or \`failed\`.

\`DELETE /geodata/upload/sessions/{identifier}\` cancels an upload that has not been assembled yet. Files are verified by the background worker (format signature, Shapefile archive limits), so a bad file shows up as a \`failed\` job rather than an HTTP error.`;
}

function components(settings: OpenApiSettings): ComponentsObject {
  return {
    schemas: buildSchemas(settings),
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "next-auth.session-token",
        description:
          "NextAuth JWT session cookie from `POST /api/auth/callback/credentials`. Named `__Secure-next-auth.session-token` " +
          "when the app runs over HTTPS. Browsers send it automatically on this page.",
      },
      bearerToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWE",
        description:
          "Access token from `POST /api/mobile/token`, sent as `Authorization: Bearer <token>`. Takes precedence over the session cookie.",
      },
      signedTerrainUrl: {
        type: "apiKey",
        in: "query",
        name: "t",
        description:
          "Signed token from `GET /api/mobile/layers/{layerId}/terrain-url`, accepted by the terrain endpoints of that one layer " +
          "for 12 hours. When present it is the only credential checked.",
      },
    },
    parameters: {
      TerrainLayerId: pathParameter("layerId", "Id of a published terrain layer.", { type: "string", pattern: ULID_PATTERN }, SAMPLE_IDS.terrainLayer),
      LayerUlid: pathParameter("layer", "Layer id.", { type: "string", pattern: CROCKFORD_ULID_PATTERN }, SAMPLE_IDS.terrainLayer),
      TileZ: pathParameter("z", "Zoom level.", { type: "integer", minimum: 0, maximum: 99 }, 10),
      TileX: pathParameter("x", "Tile column.", { type: "integer", minimum: 0, maximum: 999_999_999 }, 845),
      TileY: pathParameter("y", "Tile row.", { type: "integer", minimum: 0, maximum: 999_999_999 }, 513),
      UploadIdentifier: pathParameter("identifier", "Upload session id.", schemaRef("UploadIdentifier"), SAMPLE_IDS.demUpload),
      JobId: pathParameter("job", "Conversion job id (`job_id`).", { type: "string", pattern: CROCKFORD_ULID_PATTERN }, SAMPLE_IDS.terrainJob),
    },
    headers: {
      RetryAfter: { description: "Seconds until the rate-limit window resets.", schema: { type: "integer", minimum: 1 } },
      RateLimitLimit: { description: "Requests allowed per minute.", schema: { type: "integer" } },
      RateLimitRemaining: { description: "Requests left in the window (always 0 on a 429).", schema: { type: "integer" } },
      SessionCookie: {
        description: "`next-auth.session-token=<jwt>; Path=/; HttpOnly; SameSite=Lax` (plus `Secure` and the `__Secure-` prefix over HTTPS).",
        schema: { type: "string" },
      },
      CsrfCookie: { description: "`next-auth.csrf-token=<token>|<hash>; Path=/; HttpOnly; SameSite=Lax`.", schema: { type: "string" } },
    },
    responses: {
      Unauthenticated: errorResponse("Not signed in, or the session was revoked.", { unauthenticated: "Unauthenticated." }),
      Forbidden: errorResponse("The user's role may not call this endpoint.", { forbidden: "This action is unauthorized." }),
      NotFound: errorResponse("Not found (also: not published, malformed id, or owned by another user).", { notFound: "Not Found" }),
      MalformedJson: errorResponse("The body is not valid JSON.", { malformed: "Malformed JSON body." }),
      CsrfMismatch: errorResponse("Cross-origin request: `Origin` / `Sec-Fetch-Site` does not match the app.", {
        csrf: "CSRF token mismatch.",
      }),
      InsufficientStorage: errorResponse(`Not enough free disk space (the server keeps ${settings.minFreeDiskMb} MB free).`, {
        storage: "Insufficient storage space.",
      }),
      ServerError: jsonResponse("Unexpected error. In production the message is always \"Server Error\".", schemaRef("Error"), {
        serverError: { summary: "Server Error", value: { message: "Server Error" } },
      }),
    },
  };
}

/** The OpenAPI 3.1 document of the HTTP API (served at /api/api-docs/openapi.json). */
export function buildOpenApiSpec(settings: OpenApiSettings = currentOpenApiSettings()): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: `${settings.appName} API`,
      version: API_VERSION,
      description: description(settings),
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/", description: "This application" }],
    security: [{ sessionCookie: [] }, { bearerToken: [] }],
    tags: TAGS,
    paths: buildPaths(settings),
    components: components(settings),
  };
}
