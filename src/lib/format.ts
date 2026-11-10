/**
 * Formatting helpers shared by server code and React components (Carbon / Laravel equivalents).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "09 Nov 2026" (PHP "d M Y"). Pass `utc: true` for DATE columns (stored at UTC midnight).
 */
export function formatDate(value: Date | string | number | null | undefined, options: { utc?: boolean } = {}): string | null {
  const date = toDate(value);
  if (!date) return null;
  const day = options.utc ? date.getUTCDate() : date.getDate();
  const month = options.utc ? date.getUTCMonth() : date.getMonth();
  const year = options.utc ? date.getUTCFullYear() : date.getFullYear();
  return `${String(day).padStart(2, "0")} ${MONTHS[month]} ${year}`;
}

/** "2026-11-09" for a DATE column (or null). */
export function toDateInputValue(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

/** "09 Nov 2026, 14:05" */
export function formatDateTime(value: Date | string | number | null | undefined): string | null {
  const date = toDate(value);
  if (!date) return null;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${formatDate(date)}, ${time}`;
}

/** Carbon's diffForHumans(): "5 minutes ago", "1 hour ago", "2 days ago", "3 weeks from now". */
export function diffForHumans(value: Date | string | number | null | undefined, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "";
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const future = seconds < 0;
  const abs = Math.abs(seconds);
  const units: Array<[string, number]> = [
    ["year", 365 * 24 * 3600],
    ["month", 30 * 24 * 3600],
    ["week", 7 * 24 * 3600],
    ["day", 24 * 3600],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  for (const [unit, size] of units) {
    if (abs >= size || unit === "second") {
      const count = Math.max(1, Math.floor(abs / size));
      return `${count} ${unit}${count === 1 ? "" : "s"} ${future ? "from now" : "ago"}`;
    }
  }
  return "";
}

/** "12.5 MB" (Layer::getFormattedSizeAttribute). */
export function formatBytes(bytes: number | bigint | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${Math.round((value / 1024 ** index) * 100) / 100} ${units[index]}`;
}

/** Str::slug() for ASCII names. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/@/g, " at ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
