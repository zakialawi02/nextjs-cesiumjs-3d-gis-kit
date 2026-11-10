import nodemailer, { type Transporter } from "nodemailer";

import { env } from "@/env";

/**
 * Outgoing mail over SMTP (Laravel's mailer, config/mail.php). Only used when MAIL_SMTP_ON=true;
 * pages check `mailEnabled()` first and tell the user to contact an admin otherwise.
 */

export function mailEnabled(): boolean {
  return env.MAIL_SMTP_ON;
}

const globalForMail = globalThis as typeof globalThis & { __mailTransport?: Transporter };

function transport(): Transporter {
  globalForMail.__mailTransport ??= nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    auth: env.MAIL_USERNAME ? { user: env.MAIL_USERNAME, pass: env.MAIL_PASSWORD ?? "" } : undefined,
  });
  return globalForMail.__mailTransport;
}

export type MailMessage = { to: string; subject: string; text: string; html: string };

export async function sendMail(message: MailMessage): Promise<void> {
  await transport().sendMail({
    from: { name: env.MAIL_FROM_NAME || env.APP_NAME, address: env.MAIL_FROM_ADDRESS },
    ...message,
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Laravel's ResetPassword notification (same subject and wording). */
export async function sendPasswordResetMail(to: string, url: string, expireMinutes: number): Promise<void> {
  const appName = env.APP_NAME;
  const lines = {
    intro: "You are receiving this email because we received a password reset request for your account.",
    expire: `This password reset link will expire in ${expireMinutes} minutes.`,
    outro: "If you did not request a password reset, no further action is required.",
    subcopy: 'If you\'re having trouble clicking the "Reset Password" button, copy and paste the URL below into your web browser:',
  };

  const text = [
    "Hello!",
    "",
    lines.intro,
    "",
    `Reset Password: ${url}`,
    "",
    lines.expire,
    "",
    lines.outro,
    "",
    "Regards,",
    appName,
  ].join("\n");

  const safeUrl = escapeHtml(url);
  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:570px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
    <tr><td>
      <h1 style="font-size:18px;margin:0 0 16px;">Hello!</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">${escapeHtml(lines.intro)}</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;">Reset Password</a>
      </p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">${escapeHtml(lines.expire)}</p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">${escapeHtml(lines.outro)}</p>
      <p style="font-size:15px;line-height:1.5;margin:0;">Regards,<br>${escapeHtml(appName)}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">
      <p style="font-size:12px;line-height:1.5;color:#64748b;margin:0;">${escapeHtml(lines.subcopy)} <span style="word-break:break-all;"><a href="${safeUrl}" style="color:#047857;">${safeUrl}</a></span></p>
    </td></tr>
  </table>
</body>
</html>`;

  await sendMail({ to, subject: "Reset Password Notification", text, html });
}
