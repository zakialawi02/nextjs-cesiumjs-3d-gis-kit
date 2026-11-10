import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell, BackToLoginFooter } from "@/components/app/auth-shell";
import { env } from "@/env";
import { getCurrentUser } from "@/server/auth";
import { mailEnabled } from "@/server/mail";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: { absolute: `Forgot Password | ${env.APP_NAME}` },
};

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <AuthShell appName={env.APP_NAME}>
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-foreground">Forgot Password?</h2>
        <p className="mt-2 text-sm text-base-content-muted">
          No problem. Enter your email and we&apos;ll send you a password reset link.
        </p>
      </div>

      <ForgotPasswordForm mailEnabled={mailEnabled()} />

      <BackToLoginFooter />
    </AuthShell>
  );
}
