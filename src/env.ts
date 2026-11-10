import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((value) => value === "true" || value === "1");

const integerString = (fallback: number) =>
  z.coerce.number().int().optional().transform((value) => value ?? fallback);

export const env = createEnv({
  /**
   * Server-side environment variables. Shared by the Next.js server, the queue worker
   * (src/worker) and the CLI scripts, which load .env through @next/env first.
   */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_NAME: z.string().default("3D WebGIS Core"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    DATABASE_URL: z.string().url(),

    NEXTAUTH_URL: z.string().url().optional(),
    NEXTAUTH_SECRET: z.string().optional(),
    AUTH_SECRET: process.env.NODE_ENV === "production" ? z.string() : z.string().optional(),
    SESSION_LIFETIME: integerString(120),
    AUTH_OAUTH_ALLOW_SIGNUP: booleanString,
    AUTH_DISCORD_ID: z.string().optional(),
    AUTH_DISCORD_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_GITHUB_ID: z.string().optional(),
    AUTH_GITHUB_SECRET: z.string().optional(),

    MAIL_SMTP_ON: booleanString,
    MAIL_HOST: z.string().default("127.0.0.1"),
    MAIL_PORT: integerString(1025),
    MAIL_SECURE: booleanString,
    MAIL_USERNAME: z.string().optional(),
    MAIL_PASSWORD: z.string().optional(),
    MAIL_FROM_ADDRESS: z.string().default("hello@example.com"),
    MAIL_FROM_NAME: z.string().optional(),

    GEODATA_MAX_UPLOAD_MB: integerString(1000),
    GEODATA_UPLOAD_SESSION_HOURS: integerString(24),
    GEODATA_UPLOAD_MAX_SESSIONS: integerString(4),
    GEODATA_UPLOAD_MAX_INFLIGHT_MB: integerString(2000),
    GEODATA_MIN_FREE_DISK_MB: integerString(512),
    GEODATA_ZIP_MAX_UNCOMPRESSED_MB: integerString(2000),
    GEODATA_DOCKER_COMPOSE_FILE: z.string().default("docker-compose.tools.yml"),
    GEODATA_DOCKER_COMPOSE_BIN: z.string().default("docker compose"),
    GEODATA_CONVERTER_USER: z.string().optional(),
    GEODATA_ENABLE_PYTHON_COLOR_PARSER: booleanString,
    GEODATA_TERRAIN_MIN_ZOOM: integerString(0),
    GEODATA_TERRAIN_MAX_ZOOM: integerString(15),

    GIS_UTM_ZONE: integerString(49),
    GIS_UTM_HEMISPHERE: z.string().default("N"),
  },

  client: {},

  /**
   * Runtime values must be listed explicitly for Next.js.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    APP_NAME: process.env.APP_NAME,
    APP_URL: process.env.APP_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    SESSION_LIFETIME: process.env.SESSION_LIFETIME,
    AUTH_OAUTH_ALLOW_SIGNUP: process.env.AUTH_OAUTH_ALLOW_SIGNUP,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
    MAIL_SMTP_ON: process.env.MAIL_SMTP_ON,
    MAIL_HOST: process.env.MAIL_HOST,
    MAIL_PORT: process.env.MAIL_PORT,
    MAIL_SECURE: process.env.MAIL_SECURE,
    MAIL_USERNAME: process.env.MAIL_USERNAME,
    MAIL_PASSWORD: process.env.MAIL_PASSWORD,
    MAIL_FROM_ADDRESS: process.env.MAIL_FROM_ADDRESS,
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
    GEODATA_MAX_UPLOAD_MB: process.env.GEODATA_MAX_UPLOAD_MB,
    GEODATA_UPLOAD_SESSION_HOURS: process.env.GEODATA_UPLOAD_SESSION_HOURS,
    GEODATA_UPLOAD_MAX_SESSIONS: process.env.GEODATA_UPLOAD_MAX_SESSIONS,
    GEODATA_UPLOAD_MAX_INFLIGHT_MB: process.env.GEODATA_UPLOAD_MAX_INFLIGHT_MB,
    GEODATA_MIN_FREE_DISK_MB: process.env.GEODATA_MIN_FREE_DISK_MB,
    GEODATA_ZIP_MAX_UNCOMPRESSED_MB: process.env.GEODATA_ZIP_MAX_UNCOMPRESSED_MB,
    GEODATA_DOCKER_COMPOSE_FILE: process.env.GEODATA_DOCKER_COMPOSE_FILE,
    GEODATA_DOCKER_COMPOSE_BIN: process.env.GEODATA_DOCKER_COMPOSE_BIN,
    GEODATA_CONVERTER_USER: process.env.GEODATA_CONVERTER_USER,
    GEODATA_ENABLE_PYTHON_COLOR_PARSER: process.env.GEODATA_ENABLE_PYTHON_COLOR_PARSER,
    GEODATA_TERRAIN_MIN_ZOOM: process.env.GEODATA_TERRAIN_MIN_ZOOM,
    GEODATA_TERRAIN_MAX_ZOOM: process.env.GEODATA_TERRAIN_MAX_ZOOM,
    GIS_UTM_ZONE: process.env.GIS_UTM_ZONE,
    GIS_UTM_HEMISPHERE: process.env.GIS_UTM_HEMISPHERE,
  },

  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation (e.g. Docker builds).
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * Empty strings are treated as undefined.
   */
  emptyStringAsUndefined: true,
});
