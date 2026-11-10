/**
 * Browser helpers (port of the global functions in Laravel's resources/js/app.js).
 * ClientBootstrap also exposes them on `window` for the ported vanilla map scripts.
 */

/** Escape a value for safe interpolation into HTML. */
export function escapeHtml(unsafe: unknown): string {
  return (unsafe ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** The value when it is a #rrggbb hex color, otherwise the fallback (safe for style attributes). */
export function safeColor(value: unknown, fallback = "#6b7280"): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/** Parse a date string or epoch value into milliseconds (0 when invalid). */
export function parseTimestamp(value: unknown): number {
  if (!value) return 0;
  if (!Number.isNaN(Number(value))) return Number(value);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

/** Whether a date string falls in the given "YYYY-MM" month. */
export function matchMonthYear(dateStr: string | null | undefined, query: string | null | undefined): boolean {
  if (!dateStr || !query) return false;
  const [year, month] = query.split("-").map((part) => parseInt(part, 10));
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr.toLowerCase().includes(query.toLowerCase());
  }
  return date.getFullYear() === year && date.getMonth() + 1 === month;
}

/** Format a [lon, lat] pair with Indonesian hemisphere suffixes (BT/BB, LU/LS). */
export function formatIndonesianCoordinate(coordinate: [number, number], format: "dd" | "dms" = "dd") {
  const [lon, lat] = coordinate;
  const lonDirection = lon < 0 ? "BB" : "BT";
  const latDirection = lat < 0 ? "LS" : "LU";

  if (format === "dms") {
    const toDms = (value: number, direction: string) => {
      const absolute = Math.abs(value);
      const degrees = Math.floor(absolute);
      const minutes = Math.floor((absolute - degrees) * 60);
      const seconds = ((absolute - degrees - minutes / 60) * 3600).toFixed(2);
      return `${degrees}° ${minutes}' ${seconds}" ${direction}`;
    };
    return { formattedLon: toDms(lon, lonDirection), formattedLat: toDms(lat, latDirection) };
  }

  return {
    formattedLon: `${Math.abs(lon).toFixed(5)}° ${lonDirection}`,
    formattedLat: `${Math.abs(lat).toFixed(5)}° ${latDirection}`,
  };
}

/** Format a number with fixed fraction digits ("-" when invalid). */
export function formatNumber(amount: unknown, locale = "en-US", options: Intl.NumberFormatOptions = {}): string {
  const numeric = typeof amount === "string" ? parseFloat(amount) : Number(amount);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options }).format(numeric);
}
