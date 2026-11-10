import { prisma } from "@/lib/prisma";
import {
  EMAIL_PATTERN,
  messages,
  normalizeIdentifier,
  requiredString,
  USERNAME_PATTERN,
  type FieldErrors,
} from "@/server/dashboard/validation";

/**
 * Validation shared by the user management form (SaveUserRequest) and the profile form
 * (ProfileUpdateRequest): name, username and email with Laravel's normalisation and rules.
 */

/** Lower-cases and trims username / email before validation (prepareForValidation). */
export function normalizeAccountInput<T extends Record<string, unknown>>(input: T): T {
  return { ...input, username: normalizeIdentifier(input.username), email: normalizeIdentifier(input.email) };
}

export const accountFields = {
  name: requiredString("name").max(255, messages.maxString("name", 255)),
  username: requiredString("username")
    .min(3, messages.minString("username", 3))
    .max(50, messages.maxString("username", 50))
    .regex(USERNAME_PATTERN, messages.usernameFormat()),
  email: requiredString("email")
    .regex(EMAIL_PATTERN, messages.email("email"))
    .max(255, messages.maxString("email", 255)),
};

/**
 * Laravel's `Rule::unique(User::class)->ignore($id)`: checks ALL accounts, soft-deleted ones
 * included (their usernames and emails stay reserved; the database index enforces it too).
 */
export async function addUniqueAccountErrors(
  errors: FieldErrors,
  values: { username?: unknown; email?: unknown },
  ignoreId: string | null,
): Promise<void> {
  const notSelf = ignoreId ? { NOT: { id: ignoreId } } : {};
  const [usernameTaken, emailTaken] = await Promise.all([
    typeof values.username === "string" && values.username !== ""
      ? prisma.user.findFirst({ where: { username: values.username, ...notSelf }, select: { id: true } })
      : null,
    typeof values.email === "string" && values.email !== ""
      ? prisma.user.findFirst({ where: { email: values.email, ...notSelf }, select: { id: true } })
      : null,
  ]);
  if (usernameTaken) (errors.username ??= []).push(messages.unique("username"));
  if (emailTaken) (errors.email ??= []).push(messages.unique("email"));
}

/** Unique-constraint violation on users.username / users.email (a concurrent save won the race). */
export function uniqueViolationErrors(error: unknown): FieldErrors | null {
  const known = error as { code?: string; meta?: { target?: unknown } } | null;
  if (known?.code !== "P2002") return null;
  const target = JSON.stringify(known.meta?.target ?? "");
  const errors: FieldErrors = {};
  if (target.includes("username")) errors.username = [messages.unique("username")];
  if (target.includes("email")) errors.email = [messages.unique("email")];
  return Object.keys(errors).length > 0 ? errors : { email: [messages.unique("email")] };
}
