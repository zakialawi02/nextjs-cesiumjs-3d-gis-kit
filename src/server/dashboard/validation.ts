import { z, type ZodError } from "zod";

/**
 * Form helpers shared by the auth and dashboard Server Actions: Laravel's request normalisation
 * (TrimStrings + ConvertEmptyStringsToNull), its English validation messages, and the result shape
 * the client forms render (`errors` keyed by field, like Laravel's error bag).
 */

export type FieldErrors = Record<string, string[]>;

/** What a form Server Action returns: a success message, or field errors / a general error message. */
export type ActionResult = { ok: true; message: string } | { ok: false; message?: string; errors?: FieldErrors };

// Laravel's TrimStrings middleware leaves these untouched.
const UNTRIMMED_FIELDS = new Set(["current_password", "password", "password_confirmation"]);

/**
 * Reads `fields` from the submitted form: strings are trimmed (except passwords) and empty strings
 * become null; files are returned as File objects; missing fields are undefined.
 */
export function formValues<const F extends string>(formData: FormData, fields: readonly F[]): Record<F, unknown> {
  const values = {} as Record<F, unknown>;
  for (const field of fields) {
    const raw = formData.get(field);
    if (raw === null) {
      values[field] = undefined;
    } else if (typeof raw === "string") {
      const value = UNTRIMMED_FIELDS.has(field) ? raw : raw.trim();
      values[field] = value === "" ? null : value;
    } else {
      values[field] = raw;
    }
  }
  return values;
}

/** "layer_category_id" → "layer category id" (Laravel's default attribute name). */
export function attribute(field: string): string {
  return field.replace(/_/g, " ");
}

/** Laravel's lang/en/validation.php lines used by these forms. */
export const messages = {
  required: (field: string) => `The ${attribute(field)} field is required.`,
  string: (field: string) => `The ${attribute(field)} field must be a string.`,
  minString: (field: string, min: number) => `The ${attribute(field)} field must be at least ${min} characters.`,
  maxString: (field: string, max: number) => `The ${attribute(field)} field must not be greater than ${max} characters.`,
  minNumeric: (field: string, min: number) => `The ${attribute(field)} field must be at least ${min}.`,
  maxNumeric: (field: string, max: number) => `The ${attribute(field)} field must not be greater than ${max}.`,
  integer: (field: string) => `The ${attribute(field)} field must be an integer.`,
  boolean: (field: string) => `The ${attribute(field)} field must be true or false.`,
  email: (field: string) => `The ${attribute(field)} field must be a valid email address.`,
  regex: (field: string) => `The ${attribute(field)} field format is invalid.`,
  unique: (field: string) => `The ${attribute(field)} has already been taken.`,
  confirmed: (field: string) => `The ${attribute(field)} field confirmation does not match.`,
  different: (field: string, other: string) => `The ${attribute(field)} field and ${attribute(other)} must be different.`,
  exists: (field: string) => `The selected ${attribute(field)} is invalid.`,
  enum: (field: string) => `The selected ${attribute(field)} is invalid.`,
  dateFormat: (field: string, format: string) => `The ${attribute(field)} field must match the format ${format}.`,
  beforeOrEqual: (field: string, date: string) => `The ${attribute(field)} field must be a date before or equal to ${date}.`,
  currentPassword: () => "The password is incorrect.",
  usernameFormat: () => "Username may only contain lowercase letters, numbers, dots, dashes and underscores.",
} as const;

/**
 * Close to Laravel's default `email` rule (RFC validation): one "@", no whitespace, no characters
 * that are only valid inside quoted local parts, and a domain without empty labels.
 */
export const EMAIL_PATTERN = /^[^\s@"(),:;<>[\]\\]+@[^\s@"(),:;<>[\]\\.]+(\.[^\s@"(),:;<>[\]\\.]+)*$/;

export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

/** A string field that must be present (null / missing / non-string → "required"). */
export function requiredString(field: string) {
  const message = messages.required(field);
  return z.string({ required_error: message, invalid_type_error: message });
}

/** An optional string field (null allowed). */
export function nullableString(field: string) {
  return z.string({ invalid_type_error: messages.string(field) }).nullable().optional();
}

/** Lower-cases a string identifier (Laravel's prepareForValidation on username / email). */
export function normalizeIdentifier(value: unknown): unknown {
  return typeof value === "string" ? value.toLowerCase() : value;
}

/** Converts zod issues into `{ field: [messages] }`, keeping the order of the checks. */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "_");
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

export function addError(errors: FieldErrors, field: string, message: string): void {
  (errors[field] ??= []).push(message);
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some((list) => list.length > 0);
}

export function invalid(errors: FieldErrors, message?: string): ActionResult {
  return { ok: false, errors, ...(message ? { message } : {}) };
}

/**
 * The value when it is a real calendar date in Y-m-d form (PHP's createFromFormat round-trip that
 * Laravel's `date_format:Y-m-d` performs), otherwise null.
 */
export function parseDateYmd(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** Today's date as "Y-m-d" in the server's time zone (Laravel's `today` for `before_or_equal`). */
export function todayYmd(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Password rules shared by user creation, profile and reset: confirmed, (different), min 8. */
export function passwordIssues(
  password: string,
  confirmation: unknown,
  options: { different?: { value: unknown; field: string } } = {},
): string[] {
  const issues: string[] = [];
  if (password !== confirmation) issues.push(messages.confirmed("password"));
  if (options.different && typeof options.different.value === "string" && password === options.different.value) {
    issues.push(messages.different("password", options.different.field));
  }
  if (password.length < 8) issues.push(messages.minString("password", 8));
  return issues;
}
