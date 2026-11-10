import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Small helpers shared by the upload / conversion services (equivalents of Laravel's Str and of
 * a few PHP built-ins whose exact behaviour the ported code depends on).
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Str::ulid(): 26-char uppercase ULID (48-bit time + 80-bit randomness), like Prisma's ulid(). */
export function ulid(time: number = Date.now()): string {
  let remaining = Math.floor(time);
  let encodedTime = "";
  for (let i = 0; i < 10; i++) {
    encodedTime = CROCKFORD[remaining % 32] + encodedTime;
    remaining = Math.floor(remaining / 32);
  }
  const bytes = randomBytes(16);
  let encodedRandom = "";
  for (let i = 0; i < 16; i++) encodedRandom += CROCKFORD[bytes[i] & 31];
  return encodedTime + encodedRandom;
}

const UUID_PATTERN = /^[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}$/;

/** Str::isUuid() */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Str::isUlid() (route model binding of HasUlids models). */
export function isUlid(value: unknown): value is string {
  return typeof value === "string" && /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/.test(value);
}

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Str::random() */
export function randomString(length: number): string {
  let result = "";
  for (let i = 0; i < length; i++) result += ALPHANUMERIC[randomInt(ALPHANUMERIC.length)];
  return result;
}

/** hash_equals() */
export function hashEquals(known: string, user: string): boolean {
  const a = Buffer.from(known);
  const b = Buffer.from(user);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** hash_file('sha256', $path) */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** pathinfo($name, PATHINFO_EXTENSION) */
export function fileExtension(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1);
}

const PHP_WHITESPACE = "[ \\t\\n\\r\\v\\f]";
const NUMERIC_BODY = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const NUMERIC_PATTERN = new RegExp(`^${PHP_WHITESPACE}*${NUMERIC_BODY}${PHP_WHITESPACE}*$`);
const LEADING_NUMBER_PATTERN = new RegExp(`^${PHP_WHITESPACE}*(${NUMERIC_BODY})`);
const LEADING_INTEGER_PATTERN = new RegExp(`^${PHP_WHITESPACE}*([+-]?\\d+)`);

/** is_numeric() for strings (PHP 8: leading and trailing whitespace allowed). */
export function isNumericString(value: string): boolean {
  return NUMERIC_PATTERN.test(value);
}

/** floatval() / (float) of a string: the leading numeric part, or 0. */
export function phpFloat(value: string): number {
  const match = LEADING_NUMBER_PATTERN.exec(value);
  return match ? Number(match[1]) : 0;
}

/** intval() / (int) of a string. */
export function phpInt(value: string): number {
  if (isNumericString(value)) {
    const number = Math.trunc(Number(value.trim()));
    return Number.isFinite(number) ? number : 0;
  }
  const match = LEADING_INTEGER_PATTERN.exec(value);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** Carbon::toIso8601String() in UTC: "2026-11-09T16:17:00+00:00". */
export function toIso8601String(date: Date | null | undefined): string | null {
  if (!date) return null;
  return `${date.toISOString().slice(0, 19)}+00:00`;
}

/** "YYYY-MM-DD" → Date at UTC midnight (DATE columns). */
export function dateOnly(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

/** Message of anything thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Message and stack, like `$e->getMessage()."\n".$e->getTraceAsString()`. */
export function errorWithTrace(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack?.split("\n").slice(1).join("\n") ?? "";
    return stack ? `${error.message}\n${stack}` : error.message;
  }
  return errorMessage(error);
}
