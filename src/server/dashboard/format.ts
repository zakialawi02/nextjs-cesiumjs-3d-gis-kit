/**
 * Display helpers for the dashboard pages (PHP date formats and Laravel string helpers that
 * src/lib/format.ts does not cover). Times use the server's time zone, like formatDate().
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (value: number) => String(value).padStart(2, "0");

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "H:i" → "14:05" */
export function formatTime(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : null;
}

/** "d M Y H:i" → "09 Nov 2026 14:05" */
export function formatDateTimeShort(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${formatTime(date)}`;
}

/** "D, d M Y" → "Mon, 09 Nov 2026" */
export function formatDayDate(value: Date): string {
  return `${DAYS[value.getDay()]}, ${pad(value.getDate())} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
}

/** Carbon's string form "Y-m-d H:i:s" (used for title tooltips). */
export function formatTimestamp(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** PHP number_format(): "1,234" or with decimals "106.123456". */
export function numberFormat(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** ucfirst("terrain") → "Terrain" */
export function ucfirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Str::plural for regular English nouns ("1 layer", "2 layers"). */
export function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

/** Str::limit(value, limit): cut to `limit` characters and append "...". */
export function strLimit(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length <= limit ? value : `${characters.slice(0, limit).join("").trimEnd()}...`;
}

/** "published" / "process_failed" → "process failed" (status badges). */
export function statusLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export type DayPeriod = "morning" | "afternoon" | "evening" | "night";

/** Dashboard greeting and the part of the day (which picks its icon) for the hour of the day. */
export function greetingFor(hour: number): [greeting: string, period: DayPeriod] {
  if (hour < 11) return ["Good morning", "morning"];
  if (hour < 15) return ["Good afternoon", "afternoon"];
  if (hour < 19) return ["Good evening", "evening"];
  return ["Good night", "night"];
}
