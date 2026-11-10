"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/server/auth";
import {
  accountFields,
  addUniqueAccountErrors,
  normalizeAccountInput,
  uniqueViolationErrors,
} from "@/server/dashboard/accounts";
import {
  formValues,
  invalid,
  messages,
  passwordIssues,
  requiredString,
  zodFieldErrors,
  type ActionResult,
  type FieldErrors,
} from "@/server/dashboard/validation";
import { limitPerMinute } from "@/server/rate-limit";
import { reissueSessionCookie } from "@/server/session-cookie";

/** ProfileController::update (ProfileUpdateRequest): name, username and email of the signed-in user. */
export async function updateProfileAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("/profile");

  const input = normalizeAccountInput(formValues(formData, ["name", "username", "email"]));
  const parsed = z.object(accountFields).safeParse(input);
  const errors: FieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
  await addUniqueAccountErrors(errors, input, user.id);
  if (!parsed.success || Object.keys(errors).length > 0) return invalid(errors);

  try {
    // A self-chosen new address is unverified (Laravel's MustVerifyEmail behaviour): OAuth sign-ins
    // never link to it (src/lib/auth.ts), so nobody can claim another person's address this way.
    const emailChanged = parsed.data.email !== user.email;
    await prisma.user.update({
      where: { id: user.id },
      data: { ...parsed.data, ...(emailChanged ? { email_verified_at: null } : {}) },
    });
  } catch (error) {
    const unique = uniqueViolationErrors(error);
    if (unique) return invalid(unique);
    throw error;
  }

  // The header chip and the sidebar show the name: re-render the whole dashboard frame.
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile updated." };
}

/**
 * ProfileController::updatePassword (PasswordUpdateRequest, throttle:6,1). After saving the new hash
 * the current browser gets a fresh session cookie; every other session is signed out. Accounts that
 * only sign in through OAuth have no password yet and may set one without a current password.
 */
export async function updatePasswordAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("/profile");

  if (!limitPerMinute("profile-password", user.id).allowed) {
    return { ok: false, message: "Too Many Attempts." };
  }

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
  if (!account) return { ok: false, message: "User not found." };
  const storedHash = account.password;

  const input = formValues(formData, ["current_password", "password", "password_confirmation"]);
  const errors: FieldErrors = {};

  if (storedHash !== null) {
    const current = input.current_password;
    if (typeof current !== "string") {
      errors.current_password = [messages.required("current_password")];
    } else if (!(await bcrypt.compare(current, storedHash))) {
      errors.current_password = [messages.currentPassword()];
    }
  }

  const parsed = z
    .object({
      password: requiredString("password").superRefine((password, ctx) => {
        const different = storedHash !== null ? { value: input.current_password, field: "current_password" } : undefined;
        for (const message of passwordIssues(password, input.password_confirmation, { different })) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        }
      }),
    })
    .safeParse(input);
  if (!parsed.success) Object.assign(errors, zodFieldErrors(parsed.error));
  if (!parsed.success || Object.keys(errors).length > 0) return invalid(errors);

  const newHash = await bcrypt.hash(parsed.data.password, 12);

  // Only replace the hash that was verified above (a concurrent change makes this a no-op).
  const updated = await prisma.user.updateMany({
    where: { id: user.id, password: storedHash },
    data: { password: newHash },
  });
  if (updated.count === 0) {
    return invalid({ current_password: [messages.currentPassword()] });
  }

  await reissueSessionCookie(newHash);

  revalidatePath("/profile");
  return { ok: true, message: "Password changed." };
}
