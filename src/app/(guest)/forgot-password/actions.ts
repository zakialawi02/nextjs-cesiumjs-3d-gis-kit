"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/server/auth";
import { PASSWORD_STATUS, sendResetLink } from "@/server/dashboard/password-broker";
import { requestIp } from "@/server/dashboard/request";
import {
  EMAIL_PATTERN,
  formValues,
  invalid,
  messages,
  requiredString,
  zodFieldErrors,
  type ActionResult,
} from "@/server/dashboard/validation";
import { mailEnabled } from "@/server/mail";
import { limitPerMinute } from "@/server/rate-limit";

const schema = z.object({
  email: requiredString("email").regex(EMAIL_PATTERN, messages.email("email")),
});

/** PasswordResetLinkController::store (POST /forgot-password, throttle:6,1 per IP). */
export async function sendPasswordResetLinkAction(formData: FormData): Promise<ActionResult> {
  if (await getCurrentUser()) redirect("/");

  if (!limitPerMinute("forgot-password", await requestIp()).allowed) {
    return invalid({ email: ["Too Many Attempts."] });
  }

  const parsed = schema.safeParse(formValues(formData, ["email"]));
  if (!parsed.success) return invalid(zodFieldErrors(parsed.error));

  if (!mailEnabled()) {
    return invalid({ email: ["Email system is unavailable. Please contact admin manually."] });
  }

  let status;
  try {
    // Accounts store lower-case emails (normalised on save), so this is a case-insensitive lookup.
    status = await sendResetLink(parsed.data.email.toLowerCase());
  } catch (error) {
    console.error("Password reset mail failed:", error);
    return invalid({ email: ["The password reset link could not be sent. Please try again later."] });
  }

  return status === "sent" ? { ok: true, message: PASSWORD_STATUS.sent } : invalid({ email: [PASSWORD_STATUS[status]] });
}
