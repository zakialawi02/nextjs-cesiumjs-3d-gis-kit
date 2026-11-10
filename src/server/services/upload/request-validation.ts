import { validationError } from "@/server/http";
import { isUuid } from "@/server/services/support";

/**
 * A small subset of Laravel's request validation, enough for the upload endpoints, with the same
 * error messages (lang/en/validation.php) and the same input normalization (TrimStrings +
 * ConvertEmptyStringsToNull). Rules run in order and stop at a field's first failure.
 */
export type Rule =
  | "required"
  | "nullable"
  | "string"
  | "integer"
  | "uuid"
  | "file"
  | { max: number }
  | { min: number }
  | { regex: RegExp }
  | { dateFormat: "Y-m-d" }
  | { different: string }
  | { exists: (value: string) => Promise<boolean> };

export type RuleSet = Record<string, Rule[]>;

/** Str::snake() + spaces: "layer_category_id" → "layer category id", "fileName" → "file name". */
export function attributeName(field: string): string {
  return field
    .replace(/(.)(?=[A-Z])/g, "$1_")
    .toLowerCase()
    .replace(/_/g, " ");
}

/** TrimStrings + ConvertEmptyStringsToNull */
export function normalizeInput(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
}

function isFile(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

/** filter_var($value, FILTER_VALIDATE_INT) !== false */
function toInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : null;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) {
    const number = Number(value.trim());
    return Number.isSafeInteger(number) ? number : null;
  }
  return null;
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Size used by min / max: numeric value, kilobytes of a file, or string length. */
function sizeOf(value: unknown, rules: Rule[]): number {
  if (rules.includes("integer")) return toInteger(value) ?? Number.NaN;
  if (isFile(value)) return value.size / 1024;
  if (typeof value === "string") return [...value].length;
  if (typeof value === "number") return value;
  return Number.NaN;
}

async function check(field: string, value: unknown, rule: Rule, rules: Rule[], data: Record<string, unknown>): Promise<string | null> {
  const attribute = attributeName(field);
  if (rule === "required" || rule === "nullable") return null;
  if (rule === "string") return typeof value === "string" ? null : `The ${attribute} field must be a string.`;
  if (rule === "integer") return toInteger(value) !== null ? null : `The ${attribute} field must be an integer.`;
  if (rule === "uuid") return isUuid(value) ? null : `The ${attribute} field must be a valid UUID.`;
  if (rule === "file") return isFile(value) ? null : `The ${attribute} field must be a file.`;
  if ("max" in rule) {
    const size = sizeOf(value, rules);
    if (!(size <= rule.max)) {
      if (rules.includes("integer")) return `The ${attribute} field must not be greater than ${rule.max}.`;
      if (rules.includes("file")) return `The ${attribute} field must not be greater than ${rule.max} kilobytes.`;
      return `The ${attribute} field must not be greater than ${rule.max} characters.`;
    }
    return null;
  }
  if ("min" in rule) {
    const size = sizeOf(value, rules);
    if (!(size >= rule.min)) {
      if (rules.includes("integer")) return `The ${attribute} field must be at least ${rule.min}.`;
      if (rules.includes("file")) return `The ${attribute} field must be at least ${rule.min} kilobytes.`;
      return `The ${attribute} field must be at least ${rule.min} characters.`;
    }
    return null;
  }
  if ("regex" in rule) {
    return typeof value === "string" && rule.regex.test(value) ? null : `The ${attribute} field format is invalid.`;
  }
  if ("dateFormat" in rule) {
    return typeof value === "string" && isValidDate(value) ? null : `The ${attribute} field must match the format ${rule.dateFormat}.`;
  }
  if ("different" in rule) {
    const other = normalizeInput(data[rule.different]);
    return value !== other ? null : `The ${attribute} field and ${attributeName(rule.different)} must be different.`;
  }
  if ("exists" in rule) {
    return typeof value === "string" && (await rule.exists(value)) ? null : `The selected ${attribute} is invalid.`;
  }
  return null;
}

/**
 * Validates `input` against `rules` and returns the validated (normalized) fields only, or throws
 * a 422 with Laravel's `{ message, errors }` body.
 */
export async function validateRequest<T extends Record<string, unknown>>(input: Record<string, unknown>, rules: RuleSet): Promise<T> {
  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(input)) data[field] = normalizeInput(value);

  const errors: Record<string, string[]> = {};
  const validated: Record<string, unknown> = {};

  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = data[field];
    const missing = value === undefined || value === null;
    if (missing) {
      if (fieldRules.includes("required")) {
        errors[field] = [`The ${attributeName(field)} field is required.`];
      } else if (Object.hasOwn(data, field) || fieldRules.includes("nullable")) {
        validated[field] = null;
      }
      continue;
    }
    for (const rule of fieldRules) {
      const message = await check(field, value, rule, fieldRules, data);
      if (message) {
        errors[field] = [message];
        break;
      }
    }
    if (!errors[field]) validated[field] = fieldRules.includes("integer") ? toInteger(value) : value;
  }

  if (Object.keys(errors).length > 0) validationError(errors);
  return validated as T;
}
