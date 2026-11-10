import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";

import { env } from "@/env";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetMail } from "@/server/mail";

/**
 * Password reset broker (port of Laravel's PasswordBroker + DatabaseTokenRepository with
 * config/auth.php `passwords.users`): one token per email in `password_reset_tokens`, stored as a
 * sha256 hash, valid for 60 minutes, and at most one new link per email every 60 seconds.
 */

export const RESET_EXPIRE_MINUTES = 60;
export const RESET_THROTTLE_SECONDS = 60;

/** Laravel's lang/en/passwords.php. */
export const PASSWORD_STATUS = {
  reset: "Your password has been reset.",
  sent: "We have emailed your password reset link.",
  throttled: "Please wait before retrying.",
  token: "This password reset token is invalid.",
  user: "We can't find a user with that email address.",
} as const;

export type PasswordStatus = keyof typeof PASSWORD_STATUS;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokensMatch(token: string, storedHash: string): boolean {
  const given = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

function findActiveUser(email: string) {
  return prisma.user.findFirst({ where: { email, deleted_at: null }, select: { id: true, email: true } });
}

/** The reset link mailed to the user. */
export function resetUrl(token: string, email: string): string {
  return `${env.APP_URL.replace(/\/+$/, "")}/reset-password/${token}?email=${encodeURIComponent(email)}`;
}

/** Password::sendResetLink(): creates a token and mails the link. */
export async function sendResetLink(email: string): Promise<PasswordStatus> {
  const user = await findActiveUser(email);
  if (!user) return "user";

  const existing = await prisma.passwordResetToken.findUnique({ where: { email: user.email } });
  if (existing?.created_at && existing.created_at.getTime() + RESET_THROTTLE_SECONDS * 1000 > Date.now()) {
    return "throttled";
  }

  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.upsert({
    where: { email: user.email },
    create: { email: user.email, token: hashToken(token), created_at: new Date() },
    update: { token: hashToken(token), created_at: new Date() },
  });

  try {
    await sendPasswordResetMail(user.email, resetUrl(token, user.email), RESET_EXPIRE_MINUTES);
  } catch (error) {
    // Do not leave a token behind (and throttle the next attempt) when the mail never left.
    await prisma.passwordResetToken.deleteMany({ where: { email: user.email } });
    throw error;
  }

  return "sent";
}

/**
 * Password::reset(): checks the token, stores the new bcrypt hash and deletes the token. The new
 * hash changes the session fingerprint, so every existing session of the user is signed out.
 */
export async function resetPassword(email: string, token: string, password: string): Promise<PasswordStatus> {
  const user = await findActiveUser(email);
  if (!user) return "user";

  const record = await prisma.passwordResetToken.findUnique({ where: { email: user.email } });
  const expired =
    !record?.created_at || record.created_at.getTime() + RESET_EXPIRE_MINUTES * 60 * 1000 <= Date.now();
  if (!record || expired || !tokensMatch(token, record.token)) return "token";

  const hash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: hash } }),
    prisma.passwordResetToken.deleteMany({ where: { email: user.email } }),
  ]);

  return "reset";
}
