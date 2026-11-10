import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/app/auth-shell";
import { env } from "@/env";
import { AUTH_MESSAGES, configuredOAuthProviders } from "@/lib/auth";
import { getCurrentUser } from "@/server/auth";
import { internalRedirectPath } from "@/server/dashboard/redirect-target";
import { requestOrigins } from "@/server/dashboard/request";
import { FLASH_COOKIE } from "@/server/flash";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: `Login | ${env.APP_NAME}` },
};

type SearchParams = Record<string, string | string[] | undefined>;

const TRY_ANOTHER_ACCOUNT = "Try signing in with a different account.";

/**
 * Texts for `?error=` codes: the app's own OAuth refusals (src/lib/auth.ts) and NextAuth's sign-in /
 * error page codes (pages.signIn and pages.error both point here). Unknown codes get the default.
 */
const LOGIN_ERRORS: Record<string, string> = {
  oauth_no_account: AUTH_MESSAGES.oauthNoAccount,
  oauth_no_email: AUTH_MESSAGES.oauthNoEmail,
  Signin: TRY_ANOTHER_ACCOUNT,
  OAuthSignin: TRY_ANOTHER_ACCOUNT,
  OAuthCallback: TRY_ANOTHER_ACCOUNT,
  OAuthCreateAccount: TRY_ANOTHER_ACCOUNT,
  EmailCreateAccount: TRY_ANOTHER_ACCOUNT,
  Callback: TRY_ANOTHER_ACCOUNT,
  OAuthAccountNotLinked: "To confirm your identity, sign in with the same account you used originally.",
  EmailSignin: "The e-mail could not be sent.",
  CredentialsSignin: AUTH_MESSAGES.failed,
  SessionRequired: "Please sign in to access this page.",
  AccessDenied: "You do not have permission to sign in.",
  Configuration: "There is a problem with the server configuration.",
  Verification: "The sign in link is no longer valid.",
};
const DEFAULT_LOGIN_ERROR = "Unable to sign in.";
const THROTTLE_PATTERN = /^Too many login attempts\. Please try again in \d+ seconds\.$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function loginErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (Object.hasOwn(LOGIN_ERRORS, code)) return LOGIN_ERRORS[code];
  // A credentials sign-in without JavaScript lands here with the thrown message as the code.
  if (code === AUTH_MESSAGES.failed || THROTTLE_PATTERN.test(code)) return code;
  return DEFAULT_LOGIN_ERROR;
}

/** Success message flashed by the password reset (Laravel's session('status')). */
async function flashedStatus(): Promise<string | null> {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const flash = JSON.parse(raw) as { type?: string; message?: unknown };
    return flash.type === "success" && typeof flash.message === "string" ? flash.message : null;
  } catch {
    return null;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (await getCurrentUser()) redirect("/");

  const params = await searchParams;
  const origins = await requestOrigins();

  // AuthenticatedSessionController::create(): a `redirect` that leaves the app is stripped.
  let redirectTo = "/";
  if ("redirect" in params) {
    const target = internalRedirectPath(first(params.redirect), origins);
    if (target === null) redirect("/login");
    redirectTo = target;
  } else if (params.callbackUrl) {
    // NextAuth adds callbackUrl when it sends the browser back here after an OAuth error.
    redirectTo = internalRedirectPath(first(params.callbackUrl), origins) ?? "/";
  }

  return (
    <AuthShell appName={env.APP_NAME} panelClassName="md:p-10 lg:p-12">
      {/* Welcome Text */}
      <div className="mb-6 text-center">
        <h2 className="mb-1 text-lg font-semibold text-accent">Welcome Back</h2>
        <p className="text-xs text-base-content-muted">Login to access your geospatial data</p>
      </div>

      <LoginForm
        redirectTo={redirectTo}
        providers={configuredOAuthProviders}
        initialError={loginErrorMessage(first(params.error))}
        status={await flashedStatus()}
        failedMessage={AUTH_MESSAGES.failed}
      />

      <div className="mt-8 text-center">
        <div className="mb-5 h-[1px] w-full bg-border"></div>
        <p className="text-xs text-base-content-muted">
          Don&apos;t have an account? <span className="font-bold text-accent">Contact Admin</span>
        </p>
      </div>
    </AuthShell>
  );
}
