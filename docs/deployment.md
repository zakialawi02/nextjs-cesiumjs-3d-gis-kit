# Deployment Guide

How to run Next.js CesiumJS 3D GIS Kit in production. The reference setup is a single Linux server (Ubuntu 24.04 LTS) running Nginx as a TLS reverse proxy, the Next.js web process (`next start`), the queue worker as a second long-running service, PostgreSQL 16 + PostGIS 3, and Docker for the converters. Ready-to-use example files live in [`deploy/`](../deploy):

| File | Purpose |
|---|---|
| [`deploy/systemd/gis-kit-web.service`](../deploy/systemd/gis-kit-web.service) | systemd unit for `next start` on `127.0.0.1:3000` |
| [`deploy/systemd/gis-kit-worker.service`](../deploy/systemd/gis-kit-worker.service) | systemd unit for the queue worker |
| [`deploy/nginx/gis-kit.conf`](../deploy/nginx/gis-kit.conf) | Nginx site: HTTP → HTTPS redirect, TLS, proxy headers, upload size, gzip, caching |
| [`deploy/pm2/ecosystem.config.cjs`](../deploy/pm2/ecosystem.config.cjs) | PM2 alternative to the two systemd units |
| [`deploy/logrotate/gis-kit`](../deploy/logrotate/gis-kit) | Rotation of `storage/logs/*.log` |

The examples assume the domain `gis.example.com`, the install directory `/srv/gis-kit`, a system user `gis`, and a database `cesium_core` owned by a database role `gis`. Replace them consistently.

- [1. Deployment topology](#1-deployment-topology)
- [2. Server requirements](#2-server-requirements)
- [3. Step-by-step installation](#3-step-by-step-installation)
- [4. Processes: web and worker](#4-processes-web-and-worker)
- [5. Verify the deployment](#5-verify-the-deployment)
- [6. Updating a running instance](#6-updating-a-running-instance)
- [7. Logs and monitoring](#7-logs-and-monitoring)
- [8. Security checklist](#8-security-checklist)
- [9. Backups and restore](#9-backups-and-restore)
- [10. Troubleshooting](#10-troubleshooting)
- [11. Scaling notes](#11-scaling-notes)
- [12. Windows / Laragon (production-like local runs)](#12-windows--laragon-production-like-local-runs)

## 1. Deployment topology

```mermaid
flowchart TB
    users([Users' browsers])

    subgraph edge["Edge"]
        dns["DNS: gis.example.com"]
        tls["TLS certificate<br/>Let's Encrypt (Certbot)"]
    end

    subgraph host["VM · Ubuntu 24.04"]
        nginx["Nginx :443<br/>TLS, gzip, proxy headers"]
        web["gis-kit-web.service<br/>next start on 127.0.0.1:3000"]
        worker["gis-kit-worker.service<br/>node --import tsx src/worker/index.ts<br/>queues: upload, upload-failed, default,<br/>geodata-cleanup-stale (every 30 min)"]

        subgraph docker["Docker Engine"]
            gdal["gdal container<br/>network: none, read-only"]
            ctb["ctb container<br/>network: none, read-only"]
        end

        storage[("/srv/gis-kit/storage/app<br/>private · geodata · public")]
        pg[("PostgreSQL 16 + PostGIS 3<br/>localhost:5432<br/>public · geodata_vectors · pgboss")]
    end

    backup[("Off-site backups<br/>pg_dump + storage/app")]

    users -- HTTPS --> dns --> nginx
    tls -.-> nginx
    nginx -- "HTTP/1.1 proxy" --> web
    web <--> pg
    web <--> storage
    worker <--> pg
    worker <--> storage
    worker -->|docker compose run| gdal
    worker -->|docker compose run| ctb
    gdal <-->|bind mount| storage
    ctb <-->|bind mount| storage
    pg -. nightly .-> backup
    storage -. nightly .-> backup
```

Everything runs on one VM: Nginx, the web process, the worker, the Docker converters and PostgreSQL. PostgreSQL listens on `localhost` only, and `next start` binds to `127.0.0.1`, so only Nginx is reachable from the network.

Why the worker and the converters share a host: `docker-compose.tools.yml` bind-mounts `./storage/app/...` relative to the project, so the containers must run where the files are. The web process and the worker must also see the same `storage/` directory and the same `.env`.

There is no cron entry: the worker itself schedules the stale-upload cleanup every 30 minutes (pg-boss schedule `geodata-cleanup-stale`).

### Request paths at a glance

```mermaid
flowchart LR
    b([Browser]) -->|HTTPS| nginx[Nginx]
    nginx -->|"/_next/static/*, /cesium/*, /assets/*"| static["next start: build output and public/"]
    nginx -->|"/, /dashboard/*, /profile, /login"| pages["Pages and Server Actions"]
    nginx -->|"/api/auth/*"| auth[NextAuth]
    nginx -->|"/api/api-docs"| docs["Swagger UI + OpenAPI spec"]
    nginx -->|"/geodata/*"| api[Route handlers]
    api -->|layer lists, vector GeoJSON| pg[(PostGIS)]
    api -->|terrain and ortho tiles, icons| disk[(storage/app/public)]
    api -->|upload chunks| priv[(storage/app/private)]
    api -->|enqueue job| q[(pgboss schema)]
    q --> w[Worker] --> conv[GDAL / CTB containers]
```

Nothing under `storage/` is ever served by Nginx: tiles, vector GeoJSON and category icons only leave the server through authenticated route handlers.

## 2. Server requirements

| Resource | Minimum | Recommended | Notes |
|---|---|---|---|
| CPU | 2 vCPU | 4+ vCPU | Each converter container is limited to `GEODATA_CONVERTER_CPUS` (default 2). |
| RAM | 4 GB (+ swap for `next build`) | 8–16 GB | Each converter is limited to `GEODATA_CONVERTER_MEMORY` (default 4 GB); add the web process, the worker, PostgreSQL and the build on top. |
| Disk | 40 GB SSD | 200 GB+ SSD | Uploads, reprojected copies and tile pyramids grow quickly; terrain tiles are many small files (watch inodes). Uploads are refused below `GEODATA_MIN_FREE_DISK_MB` free. |
| OS | Ubuntu 22.04 / 24.04 or Debian 12 | Ubuntu 24.04 | Any Linux with Docker and systemd works. |
| Software | Nginx, Node.js 22.12+ (24 LTS recommended), PostgreSQL 14+ with PostGIS 3, Docker Engine + Compose v2, Git, Certbot | | Node.js 22.12 is the minimum because of pg-boss 12. |

## 3. Step-by-step installation

The commands target a fresh Ubuntu 24.04 server and a user with `sudo`. Commands for the application run as the `gis` user (`sudo -u gis -H …`) from `/srv/gis-kit`.

### Step 1. System packages and firewall

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates gnupg nginx certbot python3-certbot-nginx ufw

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Step 2. Node.js LTS

Install Node.js 24 LTS from NodeSource (puts `node` in `/usr/bin`, which the systemd units use):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node -v    # v24.x; at least v22.12 is required
```

Using nvm instead works too; then replace `/usr/bin/node` in the systemd units with the absolute path printed by `which node` for the `gis` user.

### Step 3. PostgreSQL 16 + PostGIS

```bash
sudo apt install -y postgresql postgresql-16-postgis-3
```

Create the role, the database and the PostGIS extension:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE gis LOGIN PASSWORD 'change-me';
CREATE DATABASE cesium_core OWNER gis;
\c cesium_core
CREATE EXTENSION IF NOT EXISTS postgis;
SQL
```

Why this way:

- The first migration runs `CREATE EXTENSION IF NOT EXISTS postgis`. PostGIS is not a trusted extension, so only a superuser can create it; creating it here turns that statement into a no-op for the unprivileged `gis` role.
- As the database owner, `gis` can create the tables in `public` (on PostgreSQL 15+ the `public` schema belongs to the database owner), the `geodata_vectors` schema (first migration) and the `pgboss` schema (created by pg-boss on its first start). No superuser rights are needed at runtime.
- Ubuntu's PostgreSQL listens on `localhost` only by default; keep it that way.

Use a strong password and URL-encode special characters when you put it into `DATABASE_URL`.

### Step 4. Docker Engine + Compose v2

Install Docker from Docker's apt repository (<https://docs.docker.com/engine/install/ubuntu/>):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
```

### Step 5. Service user and directory

```bash
sudo useradd --system --create-home --home-dir /home/gis --shell /usr/sbin/nologin gis
sudo usermod -aG docker gis
sudo mkdir -p /srv/gis-kit
sudo chown gis:gis /srv/gis-kit
id gis      # note uid and gid, e.g. uid=998(gis) gid=998(gis)
```

> Membership of the `docker` group is equivalent to root on the host. Only the worker needs it, but both services run as `gis` here, so keep the server dedicated to this app. A rootless Docker install for the `gis` user is a stricter alternative.

### Step 6. Get the code

```bash
sudo -u gis -H git clone <your-repo-url> /srv/gis-kit
cd /srv/gis-kit
```

Create the storage directories that Docker bind-mounts. If they are missing, the first `docker compose run` creates them owned by `root`, and the worker can then no longer write tiles into them:

```bash
sudo -u gis mkdir -p storage/app/private storage/app/geodata \
  storage/app/public/terrain-tiles storage/app/public/xyz-tiles storage/app/public/icons storage/logs
sudo chmod 750 /srv/gis-kit/storage
```

### Step 7. Configure `.env`

```bash
sudo -u gis cp .env.example .env
sudo -u gis chmod 600 .env
openssl rand -base64 32                  # copy the output into AUTH_SECRET="…"
sudo -u gis nano .env
```

Production values (the full list is in [development.md](development.md#4-configuration-reference)):

```dotenv
APP_NAME="Your GIS"
APP_URL=https://gis.example.com
# Same URL as APP_URL. With https:// the session cookie is named __Secure-next-auth.session-token
# and only sent over HTTPS.
NEXTAUTH_URL=https://gis.example.com

DATABASE_URL="postgresql://gis:change-me@127.0.0.1:5432/cesium_core"

# 32 random bytes, base64 (openssl rand -base64 32); required when NODE_ENV=production.
AUTH_SECRET="…"
SESSION_LIFETIME=120

# OAuth (optional): set the ID/SECRET pairs you use and register
# https://gis.example.com/api/auth/callback/<discord|github|google> with the provider.
AUTH_OAUTH_ALLOW_SIGNUP=false

# Password-reset mail; leave MAIL_SMTP_ON=false without a working SMTP server.
MAIL_SMTP_ON=true
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USERNAME=gis@example.com
MAIL_PASSWORD=…
MAIL_FROM_ADDRESS="gis@example.com"
MAIL_FROM_NAME="${APP_NAME}"

# uid:gid of the gis user (from `id gis`), so converter output belongs to the worker.
GEODATA_CONVERTER_USER=998:998
# Read by Docker Compose for the converter limits.
GEODATA_CONVERTER_MEMORY=4g
GEODATA_CONVERTER_CPUS=2

GIS_UTM_ZONE=49
GIS_UTM_HEMISPHERE=N
```

`.env` must be complete **before** the build: `next build` validates the environment through `src/env.ts`.

### Step 8. Install dependencies, migrate, seed, build

```bash
cd /srv/gis-kit
sudo -u gis -H npm ci --include=dev       # also runs prisma generate and copies Cesium assets
sudo -u gis -H npx prisma migrate deploy  # tables, geodata_vectors schema (PostGIS already exists)
sudo -u gis -H npm run db:seed            # first deploy only: admin / engineering + categories
sudo -u gis -H npm run build              # next build (copies Cesium assets first)
sudo -u gis -H docker compose -f docker-compose.tools.yml pull
```

Keep the devDependencies (`--include=dev`, and do not export `NODE_ENV=production` in the shell before `npm ci`): `next build` needs Tailwind and TypeScript. The runtime tools `tsx` (worker, seed) and the `prisma` CLI (migrations) are regular dependencies.

`npm run setup` is a shortcut for `prisma migrate deploy && prisma db seed && npm run build`.

### Step 9. Run the web process and the worker

```bash
sudo cp deploy/systemd/gis-kit-web.service deploy/systemd/gis-kit-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gis-kit-worker gis-kit-web
systemctl status gis-kit-web gis-kit-worker
curl -fsS http://127.0.0.1:3000/up        # {"status":"up"}
```

Edit the units first if your user, directory or `node` path differ. See [section 4](#4-processes-web-and-worker) for what they do and for the PM2 alternative.

### Step 10. HTTPS certificate and Nginx

Obtain the certificate with Certbot's Nginx authenticator (the default site answers the challenge on port 80), then install the site:

```bash
sudo certbot certonly --nginx -d gis.example.com --deploy-hook "systemctl reload nginx"

sudo cp deploy/nginx/gis-kit.conf /etc/nginx/sites-available/gis-kit.conf
sudo sed -i 's/gis.example.com/your.domain.example/g' /etc/nginx/sites-available/gis-kit.conf
sudo ln -s /etc/nginx/sites-available/gis-kit.conf /etc/nginx/sites-enabled/gis-kit.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
```

What the site config does and why it matters for this app:

| Setting | Why |
|---|---|
| `proxy_pass http://127.0.0.1:3000` with HTTP/1.1 keep-alive | The map requests hundreds of tiles per view; `next start` runs with `--keepAliveTimeout 65000`, longer than Nginx's 60 s upstream keep-alive. |
| `client_max_body_size 8m` | Upload chunks are 2 MB plus multipart overhead (at least 3 MB is needed); Server Actions are capped at 2 MB by `next.config.ts`. |
| `X-Forwarded-For $remote_addr` (overwrite, not append), `X-Real-IP` | Login and password-reset rate limits use the **first** `X-Forwarded-For` hop as the client IP. Appending would let clients choose their own IP. |
| `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto` | The same-origin (CSRF) check of the route handlers and the post-login redirect check compare the request's `Origin` with these values and `APP_URL`. |
| `gzip_types … application/octet-stream` | Terrain tiles are sent decompressed by the route handler, and `next start` does not compress `application/octet-stream`; Nginx compresses them instead. |
| `/cesium/` cached for 7 days | Cesium's static workers and assets; Next.js serves `public/` with `max-age=0`. |
| HSTS and security headers | `next.config.ts` sets none of them. |
| `proxy_read_timeout 300s` | Large vector layers are streamed as GeoJSON. |

### Step 11. First login

1. Open `https://gis.example.com`; you are redirected to `/login`.
2. Sign in as `admin` / `admin`, open **Edit Profile** and change the password immediately. Do the same for `engineering` (sign in as it, or set a new password under **Dashboard → Users**), or delete that account.
3. Create real accounts under **Dashboard → Users**. The seed never overwrites existing users, so later `npm run db:seed` runs are safe.

Then run through [section 5](#5-verify-the-deployment).

## 4. Processes: web and worker

| Service | Command | Equivalent npm script | Notes |
|---|---|---|---|
| `gis-kit-web` | `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000 --keepAliveTimeout 65000` | `npm start` (`next start`) | Next.js loads `.env` itself. `next start` reads the port from `--port` or `PORT`, the bind address only from `--hostname` (default `0.0.0.0`). |
| `gis-kit-worker` | `node --import tsx src/worker/index.ts` | `npm run worker` (`tsx src/worker/index.ts`) | Loads `.env` via `src/server/load-env.ts` from its working directory. Needs the `docker` group. `NODE_ENV=production` is set in the unit. |

The units call Node.js directly instead of `npm`, so that systemd's SIGTERM reaches the application process rather than an npm wrapper. Do not use `EnvironmentFile=/srv/gis-kit/.env`: systemd does not expand `${APP_NAME}`-style references, and both processes read `.env` anyway. `Environment=` lines in the units override `.env`.

**Worker shutdown.** On SIGTERM (or SIGINT) the worker stops fetching jobs, gives running jobs `WORKER_SHUTDOWN_TIMEOUT_MS` (unit: 60 s; default 30 s) to finish, then aborts them: the converter process is killed, leftover containers are `docker kill`ed by their `conversion_job_id` label, and pg-boss fails the job, which is retried once (or dead-lettered and marked failed if it was already the retry). The unit's `TimeoutStopSec=120` must stay above `WORKER_SHUTDOWN_TIMEOUT_MS / 1000 + 20 s`, and `KillMode=mixed` makes sure only the worker gets the SIGTERM. To let long terrain conversions finish during restarts, raise both (for example `WORKER_SHUTDOWN_TIMEOUT_MS=7200000` and `TimeoutStopSec=7300`).

**How many workers.** One worker runs one upload job at a time (plus layer cleanups in parallel). For parallel conversions, run additional worker instances (for example a templated copy of the unit); pg-boss distributes the jobs, and the singleton policy plus a Postgres advisory lock prevent two workers from converting the same upload. Each extra worker may start another converter container, so size RAM accordingly.

### PM2 alternative

```bash
sudo npm install -g pm2
cd /srv/gis-kit
sudo -u gis -H pm2 start deploy/pm2/ecosystem.config.cjs
sudo -u gis -H pm2 save
sudo env PATH=$PATH pm2 startup systemd -u gis --hp /home/gis
```

The ecosystem file runs the same two commands. PM2 stops processes with SIGINT and kills them after `kill_timeout` (worker: 90 s, above `WORKER_SHUTDOWN_TIMEOUT_MS` + 20 s). Logs go to `/home/gis/.pm2/logs`. Use either systemd or PM2, not both.

## 5. Verify the deployment

- [ ] `curl -fsS https://gis.example.com/up` returns `{"status":"up"}` (503 `{"status":"down"}` means the database is unreachable).
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' https://gis.example.com/geodata/layers/all` prints `401` (the API refuses requests without a session).
- [ ] `journalctl -u gis-kit-worker -n 20` shows `Queue worker started (queues: upload, upload-failed, default, geodata-cleanup-stale).`
- [ ] `https://gis.example.com` redirects to `/login`; signing in works, and the browser's cookie list shows `__Secure-next-auth.session-token` (proves `NEXTAUTH_URL` is https).
- [ ] The globe renders (no 404s for `/cesium/...` in the browser's network tab).
- [ ] Upload a small GeoJSON in the **Data** panel: the card goes from queued to done, `journalctl -u gis-kit-worker` and `storage/logs/vector_conversion.log` show the steps, and the layer appears in the **Layers** panel and on the globe.
- [ ] Upload a small single-band DEM GeoTIFF: `storage/logs/terrain_conversion.log` shows the `[STEP …]` lines, the layer loads, and the `.terrain` requests return 200 (larger tiles with `Content-Encoding: gzip`, added by Nginx).
- [ ] `ls -ln storage/app/public/terrain-tiles` shows the `gis` uid/gid (not 0), confirming `GEODATA_CONVERTER_USER`.
- [ ] `https://gis.example.com/api/api-docs` shows the API documentation when signed in.
- [ ] With `MAIL_SMTP_ON=true`: **Forgot password** delivers a mail whose link starts with `APP_URL`.
- [ ] The seeded passwords are changed.

## 6. Updating a running instance

```bash
cd /srv/gis-kit
sudo -u gis -H git pull --ff-only

# Stop both: npm ci and next build replace files the running processes load lazily.
sudo systemctl stop gis-kit-web gis-kit-worker

sudo -u gis -H npm ci --include=dev
sudo -u gis -H npx prisma migrate deploy
sudo -u gis -H npm run build
sudo -u gis -H docker compose -f docker-compose.tools.yml pull    # only when you want newer converter images

sudo systemctl start gis-kit-worker gis-kit-web
curl -fsS http://127.0.0.1:3000/up
```

Notes:

- Stopping the worker aborts a running conversion after `WORKER_SHUTDOWN_TIMEOUT_MS`; it is retried once when the worker is back. Check the **Data** panel (Active Uploads) or `SELECT id, status FROM conversion_jobs WHERE status IN ('queued','processing');` before updating, or raise the shutdown timeout as described in [section 4](#4-processes-web-and-worker).
- Uploads cannot be sent while the web process is down (the client retries chunk requests with back-off, and unfinished uploads can be resumed for `GEODATA_UPLOAD_SESSION_HOURS`).
- After changing only `.env`, restart both services (`sudo systemctl restart gis-kit-web gis-kit-worker`); rebuild as well when you change `APP_NAME`, because statically pre-rendered pages pick it up at build time.
- **Shorter downtime**: build the new version in a second checkout (for example `/srv/gis-kit-next`, with its own `npm ci` and `npm run build`), then stop the services, switch directories (or a `current` symlink), run `prisma migrate deploy` and start again. `storage/` and `.env` must be shared between the checkouts (move them out and symlink them in), and the Docker bind mounts resolve `./storage` relative to the active checkout. With several web instances behind a load balancer, set the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` on all of them so Server Actions keep working across the switch.

## 7. Logs and monitoring

| Where | What |
|---|---|
| `journalctl -u gis-kit-web -f` | Next.js output, request errors, everything the logger echoes to the console. |
| `journalctl -u gis-kit-worker -f` | Worker start / stop, job progress, converter failures, pg-boss errors and warnings. |
| `/srv/gis-kit/storage/logs/app.log` | `app` channel of both processes (queue, uploads, dynamic tables, cleanup). |
| `/srv/gis-kit/storage/logs/terrain_conversion.log`, `vector_conversion.log` | Step-by-step conversion logs (`[STEP n/m]`, converter stderr). |
| `conversion_logs` / `conversion_jobs` tables | Per-attempt exit code and stderr, the job's `error_message` (also in the dashboard's layer detail). |
| `/var/log/nginx/access.log`, `error.log` | Proxy errors (502 when the web process is down, 413 for oversized bodies). |
| `/var/log/postgresql/postgresql-16-main.log` | Database errors. |
| `/home/gis/.pm2/logs` | Process output when you use PM2. |

The `storage/logs` files are appended without rotation; install the logrotate example:

```bash
sudo cp deploy/logrotate/gis-kit /etc/logrotate.d/gis-kit
```

Watch:

- Free disk space (uploads are refused below `GEODATA_MIN_FREE_DISK_MB`) and inode usage on the storage volume: `df -h /srv/gis-kit/storage && df -i /srv/gis-kit/storage`.
- Failed conversions: `SELECT id, error_message, finished_at FROM conversion_jobs WHERE status = 'failed' ORDER BY finished_at DESC LIMIT 20;`
- Queue state: `SELECT name, state, count(*) FROM pgboss.job GROUP BY 1, 2 ORDER BY 1, 2;` (jobs piling up in `created` mean the worker is not running).
- Leftover stopped converter containers after crashes: `docker ps -a --filter label=conversion_job_id` (remove with `docker container prune`).
- `GET /up` from your uptime monitor (public, returns 503 when the database is down).

## 8. Security checklist

- [ ] `AUTH_SECRET` is a long random value (`openssl rand -base64 32`), unique to this instance, and `.env` is `chmod 600`, owned by `gis`. Rotating it signs everyone out.
- [ ] `APP_URL` and `NEXTAUTH_URL` use `https://` (secure `__Secure-` session cookie); HTTP redirects to HTTPS and HSTS is enabled. Uploads need HTTPS anyway (the browser only offers `crypto.subtle` in a secure context).
- [ ] Seeded `admin` / `engineering` passwords changed (or the accounts deleted) after the first login.
- [ ] `AUTH_OAUTH_ALLOW_SIGNUP=false` unless you really want anyone with an account at an enabled provider to get an `engineering` login. OAuth links to existing accounts **by email**: enable only providers you trust to verify email addresses.
- [ ] `next start` listens on `127.0.0.1` only, and Nginx **overwrites** `X-Forwarded-For`; otherwise clients can spoof their IP and bypass the login throttle.
- [ ] Rate limits are in memory: they reset when the web process restarts and are per instance. Do not run several web instances without moving the limiter to a shared store.
- [ ] `storage/` and `.env` are never served: Nginx proxies everything to Next.js, and nothing under `storage/` is linked into `public/`.
- [ ] The `gis` user is the only non-admin user in the `docker` group; the server is dedicated to this app.
- [ ] Converter images pinned to digests in `docker-compose.tools.yml` once you have validated a version (`image: ghcr.io/osgeo/gdal@sha256:…`).
- [ ] `GEODATA_ENABLE_PYTHON_COLOR_PARSER=false` (it parses DXF on the host, outside the container sandbox).
- [ ] Firewall: only 22, 80 and 443 open; PostgreSQL bound to `localhost` (`listen_addresses = 'localhost'`, the Ubuntu default).
- [ ] SMTP credentials are specific to this app; `MAIL_SMTP_ON=false` if there is no mail server.
- [ ] Off-site backups configured and a restore tested.

## 9. Backups and restore

Back up both the database and the files; one without the other is not restorable (vector layers live in `geodata_vectors.vector_*` tables, terrain and orthophoto tiles live on disk). A plain `pg_dump` of the database includes all three schemas: `public` (app tables), `geodata_vectors` (vector layers) and `pgboss` (queue state).

```bash
sudo mkdir -p /var/backups/gis-kit && sudo chmod 700 /var/backups/gis-kit

# Database: every schema, custom format
sudo -u postgres pg_dump -Fc cesium_core | sudo tee /var/backups/gis-kit/cesium_core-$(date +%F).dump > /dev/null

# Files: sources, tiles, icons (+ .env, which holds AUTH_SECRET and credentials)
sudo tar -czf /var/backups/gis-kit/storage-$(date +%F).tar.gz -C /srv/gis-kit \
  --exclude=storage/app/private/temp_chunks storage/app .env
```

Run both nightly (for example from a root cron job or a systemd timer), delete old archives (`find /var/backups/gis-kit -mtime +14 -delete`), and copy them off the server (rsync, restic, rclone). Take the dump and the archive close together; for a fully consistent pair, stop the worker while they run.

Restore on a prepared server (steps 1–8, without seeding):

```bash
sudo systemctl stop gis-kit-web gis-kit-worker

sudo -u postgres dropdb --if-exists cesium_core
sudo -u postgres createdb -O gis cesium_core
sudo -u postgres psql -d cesium_core -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres pg_restore -d cesium_core --no-owner --role=gis /var/backups/gis-kit/cesium_core-YYYY-MM-DD.dump

sudo tar -xzf /var/backups/gis-kit/storage-YYYY-MM-DD.tar.gz -C /srv/gis-kit
sudo chown -R gis:gis /srv/gis-kit/storage /srv/gis-kit/.env

sudo -u gis -H npx prisma migrate deploy   # when the code is newer than the backup
sudo systemctl start gis-kit-worker gis-kit-web
```

`pg_restore` may report an error about `COMMENT ON EXTENSION postgis` (the `gis` role does not own the extension); it is harmless. Jobs that were running when the dump was taken are expired by pg-boss and retried.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `502 Bad Gateway` | The web process is not running or not on `127.0.0.1:3000`: `systemctl status gis-kit-web`, `journalctl -u gis-kit-web -n 50`. |
| `npm run build` fails with `Invalid environment variables` | `.env` is missing `DATABASE_URL` or `AUTH_SECRET` (required in production). Complete it before building. |
| A build missing Tailwind / TypeScript | devDependencies were skipped (`NODE_ENV=production` during `npm ci`). Run `npm ci --include=dev`. |
| Worker exits with `Cannot find package '@opentelemetry/api'` | pg-boss 12 peer dependency; reinstall with `npm ci --include=dev`. |
| Worker fails right after start on an old Node.js | pg-boss 12 needs Node.js ≥ 22.12 (`node -v`). |
| Uploads stay "queued" | The worker is not running: `systemctl status gis-kit-worker`. Queued jobs start as soon as it runs. |
| `permission denied while trying to connect to the Docker daemon socket` | `gis` is not in the `docker` group, or the worker was started before you added it: `sudo usermod -aG docker gis && sudo systemctl restart gis-kit-worker`. |
| Terrain conversion fails with `Could not create output directory` / EACCES | `storage/app/public/terrain-tiles` or `xyz-tiles` was created by Docker as root. `sudo chown -R gis:gis /srv/gis-kit/storage` and pre-create the directories (step 6). |
| Converted files are owned by root or another uid | `GEODATA_CONVERTER_USER` does not match `id gis`; fix it and restart the worker. |
| `permission denied to create extension "postgis"` during `migrate deploy` | Create the extension as `postgres` first (step 3). |
| `413 Request Entity Too Large` on uploads or category icons | `client_max_body_size` in Nginx is too small (at least `3m`). |
| Requests answer 419 "CSRF token mismatch." | The `Origin` does not match `APP_URL` or the forwarded host: check `APP_URL`, and that Nginx sets `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto`. |
| Sign-in "succeeds" but you are sent back to `/login` | `NEXTAUTH_URL` / `APP_URL` do not match the URL in the browser (scheme or host), so the `__Secure-` cookie is not sent or not found; or `AUTH_SECRET` differs between builds and runtime. Fix `.env`, restart, clear cookies. |
| "Secure uploads require HTTPS or localhost." | The site is opened over plain HTTP. Use the HTTPS URL. |
| OAuth provider reports a redirect URI mismatch | Register `https://gis.example.com/api/auth/callback/<provider>` exactly. |
| Globe is blank or `/cesium/...` returns 404 | `public/cesium` is missing: `sudo -u gis -H npm run cesium:copy` (runs on `npm ci` and `npm run build`), then restart the web service. |
| Too many login attempts after a burst of logins from one office | All requests share one IP when Nginx does not pass the real client IP (check `X-Real-IP` / `X-Forwarded-For`), or the office really shares an IP: the limit is 20 attempts per minute per IP. |

## 11. Scaling notes

- **Database**: PostgreSQL can move to a managed service with PostGIS (Amazon RDS, Cloud SQL, Azure Database for PostgreSQL). Create the PostGIS extension with the provider's admin role, then point `DATABASE_URL` at it. Each process opens a Prisma pool, a `pg` pool (`PG_POOL_MAX`, default 10) and a pg-boss pool (web 2, worker 6); size `max_connections` accordingly.
- **More conversion throughput**: run more worker processes on the same host, within RAM limits (each converter may use `GEODATA_CONVERTER_MEMORY`). Every worker needs Docker and the same `storage/`.
- **Multiple web instances**: possible only with shared `storage/app` (NFS or similar) and conversions on a host that has Docker and the same storage. Sessions are stateless JWTs (every instance needs the same `AUTH_SECRET`) and the queue lives in PostgreSQL, but the rate limiter and the 30 s "layer published" cache are per process, so limits become per instance. Use the same build on every instance and set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
- **Authenticated requests cost one query**: every API call and tile request re-reads the user row (session validation) and, for tiles, checks the layer status (cached 30 s per process). This is cheap, but keep the database close to the web process.
- **Tile delivery**: terrain and orthophoto tiles carry `Cache-Control: private, max-age=604800` because they require a session; do not put a shared cache or CDN in front of `/geodata/*` that ignores `private`.

## 12. Windows / Laragon (production-like local runs)

To try a production build on a Windows development machine (not recommended as a real server):

1. Use Laragon's PostgreSQL (with PostGIS installed for that version) and Docker Desktop. `GEODATA_CONVERTER_USER` is irrelevant on Docker Desktop.
2. Build and start in two terminals from the project root:

   ```bash
   npm run build
   npm start              # next start on http://localhost:3000
   npm run worker         # second terminal
   ```

   Or run `pm2 start deploy/pm2/ecosystem.config.cjs` (PM2 works on Windows; starting it at boot needs an extra tool such as NSSM or pm2-installer).
3. Keep `APP_URL` / `NEXTAUTH_URL` at `http://localhost:3000`: uploads need a secure context, which `localhost` counts as. To use a Laragon host name such as `https://gis-kit.test`, enable SSL for it, reverse-proxy it to `127.0.0.1:3000` with the same headers as `deploy/nginx/gis-kit.conf`, and set both URLs to the `https://` name.
4. When you run converter commands by hand in Git Bash, prefix them with `MSYS_NO_PATHCONV=1` so `/data/...` paths are not rewritten; the worker itself is not affected.
