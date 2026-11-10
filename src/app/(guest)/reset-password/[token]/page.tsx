import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell, BackToLoginFooter } from "@/components/app/auth-shell";
import { env } from "@/env";
import { getCurrentUser } from "@/server/auth";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: { absolute: `Reset Password | ${env.APP_NAME}` },
};

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getCurrentUser()) redirect("/");

  const { token } = await params;
  const { email } = await searchParams;

  return (
    <AuthShell appName={env.APP_NAME}>
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-foreground">Reset Password</h2>
        <p className="mt-2 text-sm text-base-content-muted">Create a new strong password to secure your account.</p>
      </div>

      <ResetPasswordForm token={token} email={(Array.isArray(email) ? email[0] : email) ?? ""} />

      <BackToLoginFooter />
    </AuthShell>
  );
}
