# Development Guide

How to run Next.js CesiumJS 3D GIS Kit locally, how the code is organised, and the conventions to follow when changing it.

- [1. Prerequisites](#1-prerequisites)
- [2. First-time setup](#2-first-time-setup)
- [3. Running the app](#3-running-the-app)
- [4. Configuration reference](#4-configuration-reference)
- [5. Project structure](#5-project-structure)
- [6. Working on the code](#6-working-on-the-code)
- [7. Testing and formatting](#7-testing-and-formatting)
- [8. Troubleshooting](#8-troubleshooting)

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.12+ (24 LTS tested) | pg-boss 12 requires Node.js ≥ 22.12 (Next.js 16 and Cesium 1.140 need less). npm comes with it. |
| PostgreSQL | 14+ (16 tested) | With the **PostGIS** extension installed. The first migration runs `CREATE EXTENSION IF NOT EXISTS postgis`, which needs a superuser (PostGIS is not a trusted extension). |
| Docker | Engine / Desktop with Compose v2 | Runs the GDAL and Cesium Terrain Builder converters. Only needed to convert uploads. |
| Git | any | |
| Python 3 + `ezdxf` | optional | Only for `GEODATA_ENABLE_PYTHON_COLOR_PARSER=true` (looks for `.venv/` in the project first). |

On Windows, [Laragon](https://laragon.org) provides PostgreSQL (make sure PostGIS is installed for the same PostgreSQL version) and Docker Desktop provides the converters. Linux and macOS work the same with native packages (`postgresql` + `postgis`, Docker Engine or Docker Desktop).

## 2. First-time setup

```bash
git clone <your-fork-url> nextjs-cesiumjs-3d-gis-kit
cd nextjs-cesiumjs-3d-gis-kit
```

Create an empty database (with a user that may create the PostGIS extension, e.g. the local `postgres` superuser):

```bash
createdb cesium_core_next
# or: psql -U postgres -c "CREATE DATABASE cesium_core_next;"
```

Copy the environment file and set `DATABASE_URL`:

```bash
cp .env.example .env
```

Install dependencies. `postinstall` also runs `prisma generate` and copies Cesium's static assets to `public/cesium`:

```bash
npm install
```

Generate `AUTH_SECRET` (writes it into `.env`, and `.env.local` if present):

```bash
npm run generate:auth
```

Create the tables, the PostGIS extension and the `geodata_vectors` schema, then seed the first accounts and the default layer categories:

```bash
npm run db:migrate        # prisma migrate deploy
npm run db:seed           # prisma db seed (tsx prisma/seed.ts)
```

Pull the converter images once (about 2 GB, used only when converting uploads):

```bash
docker compose -f docker-compose.tools.yml pull
```

The seed creates two local accounts and four categories (Terrain & Orthophoto, Design, Boundary, and the protected **Other**):

| Email | Username | Password | Role |
|---|---|---|---|
| `admin@mail.com` | `admin` | `admin` | Admin |
| `engineering@mail.com` | `engineering` | `engineering` | Engineering |

> These passwords are for local development only. The seed creates accounts only when the `users` table is empty (soft-deleted users included), so re-seeding never resets a changed password; categories are upserted by slug. Change the passwords before anyone else can reach the app.

`npm run setup` runs `prisma migrate deploy`, `prisma db seed` and `npm run build` in one go (useful for a production-like local run).

To start over with an empty database, drop and recreate it, run the two `db:*` commands again, and empty `storage/app/geodata`, `storage/app/public/terrain-tiles`, `storage/app/public/xyz-tiles` and `storage/app/private/temp_chunks` (keep the `.gitignore` files). Dropping the whole database also clears the `geodata_vectors` and `pgboss` schemas, which Prisma does not manage.

## 3. Running the app

```bash
npm run dev:all
```

This copies the Cesium assets if needed and starts two processes side by side (`concurrently`):

| Name | Command | Purpose |
|---|---|---|
| `next` | `next dev` | App on <http://localhost:3000> with hot reload |
| `worker` | `npm run worker:dev` (`tsx watch src/worker/index.ts`) | Works the `upload`, `upload-failed`, `default` and `geodata-cleanup-stale` queues; restarts when its code changes |

`npm run dev` starts only the Next.js dev server. Without the worker, uploads stay "queued" forever (they are processed as soon as a worker starts). Docker must be running before you upload anything.

There is no separate scheduler: the worker registers the stale-upload cleanup (every 30 minutes, UTC cron `*/30 * * * *`). To run it once by hand:

```bash
npm run geodata:cleanup-stale             # default: source files stuck for 20 hours
npm run geodata:cleanup-stale -- --hours=2
```

`tsx watch` restarts the worker when you save a file it imports. A conversion that is running at that moment is aborted after `WORKER_SHUTDOWN_TIMEOUT_MS` and retried once by pg-boss.

The API documentation (Swagger UI) is at <http://localhost:3000/api/api-docs> once you are signed in; the raw spec is at `/api/api-docs/openapi.json`, and `npm run openapi:export` writes it to `docs/openapi.json`.

### Trying the pipeline

1. Log in as `admin`, open the **Data** panel (`D`) and upload a single-band DEM GeoTIFF (optionally with an orthophoto GeoTIFF), or a GeoJSON, zipped Shapefile, DXF, DWG or Surpac STR file. CAD and STR files need the source EPSG code.
2. Watch the job in **Active Uploads**, the worker output, or `storage/logs/terrain_conversion.log` / `vector_conversion.log`.
3. Open the **Layers** panel (`L`) and toggle the new layer on.
4. Use the ruler button on the right toolbar for distance, area and circle measures, or **Vol/Profile** for cut & fill and elevation profiles (these need an active terrain).
5. Rename, recategorize, archive or delete the layer under **Dashboard → Layer Management**.

## 4. Configuration reference

Everything below lives in `.env` (see `.env.example`). Variables are validated by `src/env.ts`; empty strings count as unset, and booleans are `true` only for `true` or `1`. Next.js loads `.env` itself; the worker, the seed and the CLI scripts load it through `src/server/load-env.ts` from the current working directory, so run them from the project root.

| Variable | Default | Meaning |
|---|---|---|
| `APP_NAME` | `3D WebGIS Core` | Shown in page titles, the header and the reset mail. |
| `APP_URL` | `http://localhost:3000` | Public base URL. Used in password-reset links, as an allowed origin for the same-origin check, and for the secure-cookie decision when `NEXTAUTH_URL` is unset. |
| `DATABASE_URL` | (required) | PostgreSQL connection string. Used by Prisma, the raw `pg` pool (vector tables) and pg-boss (`pgboss` schema). Must be PostgreSQL with PostGIS. |
| `AUTH_SECRET` | (required in production) | Signs and encrypts session tokens. `npm run generate:auth` or `openssl rand -base64 32`. Changing it signs everyone out. `NEXTAUTH_SECRET` is accepted as a fallback. |
| `NEXTAUTH_URL` | unset | Canonical URL for NextAuth callbacks. Set it to the same value as `APP_URL`; with `https://` the session cookie gets the `__Secure-` prefix. |
| `SESSION_LIFETIME` | `120` | Idle minutes before a session without "Remember me" expires ("Remember me" lasts 30 days). |
| `AUTH_OAUTH_ALLOW_SIGNUP` | `false` | `true` creates an `engineering` account for an OAuth email that has no account; otherwise such sign-ins are refused. |
| `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` | empty | Enables Discord sign-in when both are set. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | empty | Enables GitHub sign-in when both are set. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | empty | Enables Google sign-in when both are set. |
| `MAIL_SMTP_ON` | `false` | Password-reset emails are only offered when `true`; otherwise the form tells users to contact an admin. |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` | `127.0.0.1` / `1025` / `false` | SMTP server (port 1025 matches a local Mailpit / MailHog). `MAIL_SECURE=true` for implicit TLS (port 465). |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | empty | SMTP credentials (no auth when the username is empty). |
| `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME` | `hello@example.com` / `APP_NAME` | Sender of the reset mail. |
| `GEODATA_MAX_UPLOAD_MB` | `1000` | Maximum size of one uploaded file. |
| `GEODATA_UPLOAD_SESSION_HOURS` | `24` | How long an unfinished upload can be resumed (extended by every chunk). |
| `GEODATA_UPLOAD_MAX_SESSIONS` | `4` | Concurrent upload sessions per user. |
| `GEODATA_UPLOAD_MAX_INFLIGHT_MB` | `2000` | Total in-flight upload size per user. |
| `GEODATA_MIN_FREE_DISK_MB` | `512` | Uploads are refused (507) below this free space on the storage volume. |
| `GEODATA_ZIP_MAX_UNCOMPRESSED_MB` | `2000` | Shapefile ZIP bomb guard (also: max 1000 entries, max ratio 100). |
| `GEODATA_DOCKER_COMPOSE_FILE` | `docker-compose.tools.yml` | Converter definitions, relative to the project root. |
| `GEODATA_DOCKER_COMPOSE_BIN` | `docker compose` | Use `docker-compose` for Compose v1. |
| `GEODATA_CONVERTER_USER` | `1000:1000` | UID:GID the converters run as; match the worker's user on Linux. |
| `GEODATA_ENABLE_PYTHON_COLOR_PARSER` | `false` | Optional host-side `ezdxf` DXF colour parser. Keep off unless you need it (it parses DXF outside the container sandbox). |
| `GEODATA_TERRAIN_MIN_ZOOM` / `GEODATA_TERRAIN_MAX_ZOOM` | `0` / `15` | Read into `geodataConfig.terrain`, but currently not passed to `ctb-tile`. |
| `GIS_UTM_ZONE` / `GIS_UTM_HEMISPHERE` | `49` / `N` | UTM zone (1–60, `N` or `S`) used for coordinate display, measurements and the default EPSG suggestion in the upload form. |

Process-level variables that are not part of `.env.example`:

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | set by Next.js | `next start` / `next build` use `production`. Set `NODE_ENV=production` for the worker in production too (it makes `AUTH_SECRET` mandatory and loads `.env.production*` files). |
| `PORT` | `3000` | Port of `next dev` / `next start` (or `-p`). The bind address is set with `next start -H <host>`. |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `30000` | How long the worker lets running jobs finish after SIGINT / SIGTERM before aborting them (they are then retried). |
| `GEODATA_CONVERTER_MEMORY` / `GEODATA_CONVERTER_CPUS` | `4g` / `2` | Read by Docker Compose (from `.env` or the environment) for the converter limits in `docker-compose.tools.yml`. |
| `PG_POOL_MAX` | `10` | Size of the raw `pg` pool per process. |
| `PRISMA_LOG_QUERIES` | `false` | `true` logs every Prisma query (noisy: each tile request checks the layer). |
| `LOG_SILENT` | `false` | `true` stops echoing log lines to the console (files are still written). |
| `SKIP_ENV_VALIDATION` | unset | Skips `src/env.ts` validation (used by the unit tests). |

## 5. Project structure

```text
prisma/
├── schema.prisma                       # models (snake_case columns, @@map table names)
├── migrations/                         # SQL migrations; the first creates postgis + geodata_vectors
└── seed.ts                             # admin / engineering accounts, default categories
scripts/
├── copy-cesium-assets.mjs              # node_modules/cesium → public/cesium (postinstall, dev, build)
└── generateAuth.js                     # writes AUTH_SECRET into .env
src/
├── app/
│   ├── (map)/                          # 3D map page (/)
│   ├── (guest)/                        # login, forgot-password, reset-password/[token] (+ actions.ts)
│   ├── (app)/                          # dashboard shell: dashboard, layers, layer-categories, users, profile (+ actions.ts)
│   ├── geodata/                        # route handlers: layers, categories, terrain, ortho, vector, icons, upload/*
│   ├── api/auth/[...nextauth]/         # NextAuth
│   ├── api/api-docs/                   # Swagger UI page + openapi.json route (signed-in users)
│   ├── up/                             # health check
│   ├── layout.tsx                      # root layout, boot script, providers
│   ├── forbidden.tsx, not-found.tsx    # 403 / 404 pages
│   └── globals.css                     # Tailwind 4 theme + "Map workspace" styles
├── components/
│   ├── map/                            # map page markup: command bar, panels, controls, upload modal, MapEngine
│   ├── app/                            # dashboard shell, forms, modal, buttons, pagination
│   ├── ui/                             # shadcn/ui primitives
│   └── client-bootstrap.tsx            # window helpers + flash toasts
├── config/geodata.ts                   # upload limits, converter settings, UTM zone
├── env.ts                              # validated environment
├── lib/
│   ├── auth.ts                         # NextAuth options (credentials + OAuth, JWT callbacks)
│   ├── enums.ts, roles.ts, format.ts, utm.ts, prisma.ts
│   ├── icons.ts                        # Lucide icons as SVG strings for HTML-building code
│   ├── client/                         # browser helpers, toast, popup alert, theme
│   └── map/                            # imperative CesiumJS engine (see docs/architecture.md#6-frontend-architecture)
├── server/
│   ├── auth.ts                         # getCurrentUser, requireUser/Role/Admin, requireApiUser
│   ├── http.ts                         # handler(), HttpError, same-origin check, JSON errors
│   ├── rate-limit.ts, storage.ts, logger.ts, mail.ts, flash.ts, session-cookie.ts, load-env.ts
│   ├── queue.ts                        # pg-boss queues, enqueue helpers, schedule
│   ├── db/pg.ts                        # raw pg pool, geodata_vectors schema name
│   ├── dashboard/                      # validation, pagination, password broker, request helpers
│   ├── geodata/presenters.ts           # JSON shapes shared by the endpoints
│   ├── jobs/                           # AssembleGeodataUpload, ProcessGeotiffTerrain, ProcessVectorLayer, cleanup
│   ├── openapi/                        # OpenAPI spec of the /geodata API
│   └── services/
│       ├── conversion/                 # GDAL/CTB wrappers, DXF/DWG/SHP/STR importers, docker helper
│       ├── database/                   # dynamic PostGIS tables, spatial import
│       ├── layers/                     # layer deletion
│       └── upload/                     # sessions, assembly, validation, safe ZIP/GeoJSON readers, cleanup
├── stores/                             # Zustand stores (theme, dashboard UI, scoped record dialogs)
├── scripts/cleanup-stale-uploads.ts    # npm run geodata:cleanup-stale
├── worker/                             # queue worker entry point + handlers
├── types/next-auth.d.ts                # session / JWT type extensions
└── proxy.ts                            # optimistic auth gate for pages and /geodata
storage/
├── app/private | geodata | public      # chunks, sources, tiles and icons (never served statically)
└── logs/                               # app.log, terrain_conversion.log, vector_conversion.log
tests/unit/                             # Vitest unit tests
deploy/                                 # systemd, Nginx, PM2 and logrotate examples (see docs/deployment.md)
docker-compose.tools.yml                # hardened GDAL + CTB converter services
next.config.ts                          # serverExternalPackages, authInterrupts, Server Action body limit, strict mode off
```

## 6. Working on the code

### Conventions

- **Database**: column and field names stay **snake_case** (`layer_category_id`, `created_at`) in Prisma, raw SQL and JSON payloads. Status and type values come from `src/lib/enums.ts` (`LayerStatus.Published`, `JobStatus.Failed`, …); do not scatter string literals.
- **Server Actions vs route handlers**: dashboard, profile and guest forms use Server Actions (`actions.ts` next to the page, `"use server"`, a role check first, validation with the helpers in `src/server/dashboard/validation.ts`, an `ActionResult` return value and `revalidatePath()`). JSON consumed by the map scripts goes through route handlers under `src/app/geodata`, wrapped in `handler()` from `src/server/http.ts` and guarded with `requireApiUser()`. Route handlers that touch the file system or `pg` declare `export const runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- **API documentation**: when you add or change a `/geodata` endpoint, update the spec in `src/server/openapi/` and run `npm run openapi:export` so `docs/openapi.json` stays current.
- **Worker-safe modules**: the worker imports `src/config`, `src/env.ts`, `src/lib/prisma.ts`, `src/server/{queue,logger,storage,db}`, the jobs and the services. Do not add `import "server-only"` (it throws outside Next.js) or `next/*` server APIs (`cookies()`, `headers()`, `redirect()`) to those modules.
- **Entry points outside Next.js** (worker, seed, CLI scripts) import `@/server/load-env` **first**, before anything that reads `@/env`.
- **New environment variables**: add them to the schema and `runtimeEnv` in `src/env.ts` and to `.env.example`.
- **Node-only packages** used by route handlers and the worker are listed in `serverExternalPackages` in `next.config.ts` (`pg`, `pg-boss`, `pg-query-stream`, `nodemailer`, `yauzl`); add new ones there.
- **Map engine**: `src/lib/map` is plain JavaScript that queries the DOM rendered by `src/components/map`. Keep ids, classes and `data-*` attributes in sync between the two. Every listener, timer and observer must be removed on unmount: use the managed helpers (`addPageEventListener` in `map-page.js`, `addManagedListener` in `initMapPage()`, `listenerBag()` in `ui-interactions.js`) or return a cleanup function.
- **Escaping**: when rendering JSON into HTML in the map scripts, wrap values with `escapeHtml` and colours with `safeColor` (imported from `@/lib/client/helpers`, or on `window`).
- **Icons**: Lucide. React components import from `lucide-react`; code that builds HTML strings (the map scripts, the popup alert) uses `src/lib/icons.ts` and must add new icons to its `ICONS` map.
- **Client state**: shared client state lives in Zustand stores under `src/stores/`. Use a module-level store only for state that never changes during a server render (like `ui-store.ts`); for page-scoped state use `createScopedStore()` (`src/stores/scoped-store.tsx`) so every mount starts fresh. Form field values and errors stay in the form's own `useState`.
- **UI text** is English.
- **Dependencies**: discuss before adding npm packages. The kit deliberately keeps the map engine framework-free.

### Common tasks

**Add a layer category.** Use **Dashboard → Layer Categories** (name, colour, sort order, optional PNG / WebP icon ≤ 512 KB). For a category every installation should have, add it to `seedLayerCategories()` in `prisma/seed.ts` and run `npm run db:seed` (categories are upserted by slug; existing users are not touched). The `other` slug is the protected fallback and cannot be deleted.

**Reset a user's password.** As an admin, edit the user under **Dashboard → Users** and enter a new password. If nobody can sign in any more, open Prisma Studio (`npm run db:studio`), generate a bcrypt hash and paste it into the user's `password` column:

```bash
node -e "console.log(require('bcryptjs').hashSync('new-password', 12))"
```

Re-running the seed does not help once users exist. Any password change signs out the user's existing sessions.

**Add a database migration.** Edit `prisma/schema.prisma`, then:

```bash
npx prisma migrate dev --name add_something   # same as npm run db:generate
```

`migrate dev` uses a temporary shadow database, so the database user needs `CREATEDB` and must be able to create the PostGIS extension there (a local superuser can). Commit the generated SQL under `prisma/migrations`; production applies it with `prisma migrate deploy`. Never model the `vector_*` tables in Prisma; they live in `geodata_vectors` on purpose.

**Add an OAuth provider.** Add the `AUTH_<PROVIDER>_ID` / `AUTH_<PROVIDER>_SECRET` variables to `src/env.ts` and `.env.example`, push the NextAuth provider into `oauthProviders` in `src/lib/auth.ts` behind the same "both set" check, and optionally add an icon to `PROVIDER_ICONS` in `src/app/(guest)/login/login-form.tsx` (the login page lists every configured provider automatically). Register the callback URL `<NEXTAUTH_URL>/api/auth/callback/<provider id>` with the provider, for example `http://localhost:3000/api/auth/callback/github`. Only use providers that return verified email addresses: accounts are linked by email.

**Add a new vector input format.** Accept the extension in `src/config/geodata.ts` (`allowedExtensions`), in `upload-completion-service.ts` (`VECTOR_EXTENSIONS`) and in the vector file picker (`accept` in `src/lib/map/upload/upload-modal.js`), add a content check to `headerMatchesFormat()` in `upload-file-validator.ts`, add a branch in `ProcessVectorLayer.convertToWgs84GeoJson()` that produces WGS84 GeoJSON (preferably through `GdalService` inside the `gdal` container), and add the type to `SourceFileType` in `src/lib/enums.ts`.

**Change the terrain pipeline.** Edit `terrain-conversion-service.ts`. Every external tool call goes through `runDockerCompose()`, so new tools must exist in the `gdal` or `ctb` images, and paths must be under the mounted `/data/geodata`, `/data/terrain-tiles` or `/data/xyz-tiles`.

**Add a map tool.** Add the button to the tool rail in `src/components/map/map-controls.tsx` (class `map-tool`; add `data-map-tool` and `aria-pressed="false"` when it toggles a mode, so `applyBtnStyle()` drives its pressed state), the behaviour to `CesiumMapController` in `src/lib/map/cesium-map.js` (or a new module imported by it), and wire the click in `initMapPage()` at the end of `cesium-map.js` with `addManagedListener`. Use `CesiumMapDrawer` for interactive drawing and the shared drawing control bar (`showDrawingControlBar(text, context)`). The map chrome is styled in the "Map workspace" section of `src/app/globals.css`.

**Add a dashboard page.** Create `src/app/(app)/dashboard/<name>/page.tsx` (a Server Component that starts with `await requireAdmin(PATH)` or `requireUser()`), an `actions.ts` with the mutations, and client components for forms using `src/components/app/*`. Add the navigation item in `src/app/(app)/layout.tsx`; the page must still check access itself, because the navigation only hides links.

**Add a queue job.** Add the queue to `QUEUES` / `QUEUE_DEFINITIONS` and an `enqueue…()` helper in `src/server/queue.ts`, the payload type to `src/server/jobs/types.ts`, the handler under `src/server/jobs`, and a `boss.work()` subscription in `src/worker/handlers.ts` (wrap the promise in `track()` so shutdown waits for it). Payloads carry ids only; handlers reload rows from the database.

## 7. Testing and formatting

Run the unit tests (Vitest, `tests/unit/**`; 12 files, 187 tests at the time of writing):

```bash
npm test             # vitest run
npm run test:watch   # vitest in watch mode
```

The tests need neither a database nor Docker: `vitest.config.ts` sets `SKIP_ENV_VALIDATION` and a dummy `DATABASE_URL`, and the logger does not write files under Vitest. They cover roles, the dashboard helpers (validation, pagination, redirect targets, image headers) and the upload / conversion services that run without external tools (request validation, upload file validator, GeoJSON reader, shapefile archive, Surpac STR parser, DXF colour injector, pipeline helpers). Route handlers, Prisma queries and the Docker converters are verified by hand with the pipeline walkthrough above.

Lint, type-check and format before committing:

```bash
npm run check          # eslint && tsc --noEmit
npm run format:write   # prettier (with the Tailwind plugin)
```

Build as production does (copies the Cesium assets first; needs a valid `.env`, because `src/env.ts` validates the environment during the build):

```bash
npm run build
```

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Upload stays "queued" | The worker is not running. Use `npm run dev:all`, or `npm run worker` next to `npm run dev`. Queued jobs are picked up as soon as it starts. |
| Conversion fails immediately with a Docker error | Start Docker Desktop / the Docker daemon, run `docker compose -f docker-compose.tools.yml pull`, and check `GEODATA_DOCKER_COMPOSE_BIN`. Details are in `storage/logs/*_conversion.log`. |
| Running a converter by hand in Git Bash fails with paths like `C:/Program Files/Git/data/...` | Git Bash rewrites `/data/...` arguments. Prefix the command: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.tools.yml run --rm gdal gdalinfo /data/geodata/geotiff/<file>`. The worker spawns Docker without a shell and is not affected. |
| Converted files are owned by root or cannot be deleted (Linux) | Set `GEODATA_CONVERTER_USER` to the worker user's `uid:gid` (`id -u`:`id -g`). |
| `could not open extension control file ... postgis` | Install PostGIS for your PostgreSQL version, then re-run `npm run db:migrate`. |
| `permission denied to create extension "postgis"` | Run the migration with a superuser, or create the extension once as `postgres` (`CREATE EXTENSION postgis;` in the database) and run the migration again. |
| `prisma migrate dev` fails on the shadow database | The user needs `CREATEDB` and must be able to create PostGIS in the shadow database; use the local `postgres` superuser for development. |
| Worker exits with `Cannot find package '@opentelemetry/api'` | pg-boss 12 needs it as a peer dependency; it is in `dependencies`, so run `npm install` again. |
| Worker exits with `Invalid environment variables` | `.env` was not found or is incomplete. The worker loads `.env` from its working directory: start it from the project root. |
| Globe is blank, Cesium widgets are unstyled, or `/cesium/...` returns 404 | `public/cesium` is missing or stale. Run `npm run cesium:copy` (delete `public/cesium/.version` to force a fresh copy). |
| "Secure uploads require HTTPS or localhost." | The browser only offers `crypto.subtle` in a secure context. Open the app through `http://localhost:3000`, not a LAN IP, or use HTTPS. |
| Sign-in succeeds but you land on `/login` again | `AUTH_SECRET` changed or is missing, or `NEXTAUTH_URL` does not match the URL you use (`localhost` vs `127.0.0.1`, http vs https). Fix `.env`, restart and clear the site's cookies. |
| "Too many login attempts" while testing | Wait a minute, or restart the dev server (the limiter lives in memory). |
| OAuth: "No account is linked to this sign-in" | Create a user with the same email first, or set `AUTH_OAUTH_ALLOW_SIGNUP=true`. |
| OAuth provider reports a redirect URI mismatch | Register `<NEXTAUTH_URL>/api/auth/callback/<provider>` exactly, including scheme and port. |
| API calls answer 419 "CSRF token mismatch." | The request's `Origin` is neither the page origin nor `APP_URL` (for example a tool or page on another port). Call the API from the app's own origin. |
| "Email system is unavailable" on forgot password | Set `MAIL_SMTP_ON=true` and point `MAIL_HOST` / `MAIL_PORT` at an SMTP server (Mailpit on port 1025 works locally). |
| Terrain looks corrupted after upgrading from an older build | Hard-refresh the page; `layer.json` versions the tile URLs (`terrain_revision`) so cached gzip tiles are dropped. |
| Measure or Vol/Profile results look flat | Turn on a terrain layer first; without one, heights come from the ellipsoid. |
