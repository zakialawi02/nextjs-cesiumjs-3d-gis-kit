import fs from "node:fs";
import path from "node:path";

import { STORAGE_ROOT } from "@/server/storage";

/**
 * Minimal port of Laravel's log channels: every channel appends to storage/logs/<channel>.log and
 * echoes to the console. Laravel's `terrain_conversion` / `vector_conversion` channels keep their
 * names; `app` replaces the default `laravel.log` stack.
 */
export type LogChannel = "app" | "terrain_conversion" | "vector_conversion";
export type LogLevel = "debug" | "info" | "warning" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warning(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export const LOG_DIRECTORY = path.join(STORAGE_ROOT, "logs");

let directoryReady = false;

function timestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function serializeContext(context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) return "";
  try {
    return ` ${JSON.stringify(context, (_key, value) => (typeof value === "bigint" ? Number(value) : value))}`;
  } catch {
    return " [unserializable context]";
  }
}

function appendToFile(channel: LogChannel, line: string): void {
  try {
    if (!directoryReady) {
      fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
      directoryReady = true;
    }
    fs.appendFileSync(path.join(LOG_DIRECTORY, `${channel}.log`), `${line}\n`);
  } catch {
    // Logging must never break a request or a job.
  }
}

function write(channel: LogChannel, level: LogLevel, message: string, context?: LogContext): void {
  const environment = process.env.NODE_ENV ?? "development";
  const line = `[${timestamp(new Date())}] ${environment}.${level.toUpperCase()}: ${message}${serializeContext(context)}`;

  // Unit tests (Vitest) never write log files.
  if (!process.env.VITEST) appendToFile(channel, line);

  if (process.env.LOG_SILENT === "true") return;
  const consoleLine = `[${channel}] ${line}`;
  if (level === "error") console.error(consoleLine);
  else if (level === "warning") console.warn(consoleLine);
  else console.log(consoleLine);
}

const loggers = new Map<LogChannel, Logger>();

export function logChannel(channel: LogChannel): Logger {
  let logger = loggers.get(channel);
  if (!logger) {
    logger = {
      debug: (message, context) => write(channel, "debug", message, context),
      info: (message, context) => write(channel, "info", message, context),
      warning: (message, context) => write(channel, "warning", message, context),
      error: (message, context) => write(channel, "error", message, context),
    };
    loggers.set(channel, logger);
  }
  return logger;
}

/** Default channel (Laravel's `Log::info()` without a channel). */
export const log = logChannel("app");
