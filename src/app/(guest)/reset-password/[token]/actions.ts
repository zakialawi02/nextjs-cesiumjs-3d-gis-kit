"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/server/auth";
import { PASSWORD_STATUS, resetPassword } from "@/server/dashboard/password-broker";
import { requestIp } from "@/server/dashboard/request";
import {
  EMAIL_PATTERN,
  formValues,
  invalid,
  messages,
  passwordIssues,
  requiredString,
  zodFieldErrors,
  type ActionResult,
} from "@/server/dashboard/validation";
import { setFlash } from "@/server/flash";
import { limitPerMinute } from "@/server/rate-limit";

/** NewPasswordController::store (POST /reset-password, throttle:6,1 per IP). */
export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  if (await getCurrentUser()) redirect("/");

  if (!limitPerMinute("reset-password", await requestIp()).allowed) {
    return invalid({ email: ["Too Many Attempts."] });
  }

  const input = formValues(formData, ["token", "email", "password", "password_confirmation"]);
  const schema = z.object({
    token: requiredString("token"),
    email: requiredString("email").regex(EMAIL_PATTERN, messages.email("email")),
    password: requiredString("password").superRefine((password, ctx) => {
      for (const message of passwordIssues(password, input.password_confirmation)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    }),
  });

  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalid(zodFieldErrors(parsed.error));

  const { token, email, password } = parsed.data;
  const status = await resetPassword(email.toLowerCase(), token, password);
  if (status !== "reset") return invalid({ email: [PASSWORD_STATUS[status]] });

  await setFlash("success", PASSWORD_STATUS.reset);
  redirect("/login");
}
