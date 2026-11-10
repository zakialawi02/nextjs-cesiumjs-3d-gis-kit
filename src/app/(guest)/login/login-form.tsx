"use client";

import { CircleArrowRight, LoaderCircle, Lock, LogIn, UserRound } from "lucide-react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { ButtonLight, ButtonPrimary } from "@/components/app/buttons";
import { AuthSessionStatus, InputError, InputLabel, TextInput } from "@/components/app/form-fields";
import { PasswordInput } from "@/components/app/password-input";

type Provider = { id: string; name: string };
type Errors = { id_user?: string[]; password?: string[] };

// NextAuth error codes that carry no useful detail for a credentials sign-in.
const NEXTAUTH_CODES = new Set([
  "Signin",
  "Callback",
  "Configuration",
  "AccessDenied",
  "Verification",
  "Default",
  "SessionRequired",
]);

/**
 * Login form (auth/login.blade.php). Username/email + password go through the NextAuth credentials
 * provider without a page reload; each configured OAuth provider gets a "continue with" button.
 */
export function LoginForm({
  redirectTo,
  providers,
  initialError,
  status,
  failedMessage,
}: {
  /** Sanitised internal path to open after signing in. */
  redirectTo: string;
  providers: Provider[];
  /** Message for a `?error=` code (OAuth refusals, NextAuth errors). */
  initialError: string | null;
  /** Flashed status (e.g. "Your password has been reset."). */
  status: string | null;
  failedMessage: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();
  const [oauthPending, setOauthPending] = useState<string | null>(null);

  function credentialsError(code: string | null | undefined): string {
    if (!code || code === "CredentialsSignin") return failedMessage;
    if (NEXTAUTH_CODES.has(code)) return "Unable to sign in.";
    // authorize() throws the Laravel messages (failed / throttle); next-auth passes them through.
    return code;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const idUser = String(data.get("id_user") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const remember = data.get("remember") === "on";

    // LoginRequest rules: id_user required|string|max:255, password required|string.
    const next: Errors = {};
    if (idUser === "") next.id_user = ["The id user field is required."];
    else if (idUser.length > 255) next.id_user = ["The id user field must not be greater than 255 characters."];
    if (password === "") next.password = ["The password field is required."];
    if (next.id_user || next.password) {
      setErrors(next);
      return;
    }

    setErrors({});
    setFormError(null);

    startTransition(async () => {
      try {
        const result = await signIn("credentials", {
          redirect: false,
          id_user: idUser,
          password,
          remember: remember ? "true" : "false",
          callbackUrl: redirectTo,
        });

        if (result?.ok && !result.error) {
          // Full navigation so every server component renders with the new session.
          window.location.assign(redirectTo);
          return;
        }

        setErrors({ id_user: [credentialsError(result?.error)] });
      } catch {
        setErrors({ id_user: ["Unable to sign in."] });
      }

      const passwordField = formRef.current?.elements.namedItem("password");
      if (passwordField instanceof HTMLInputElement) passwordField.value = "";
    });
  }

  function continueWith(provider: Provider) {
    setOauthPending(provider.id);
    setFormError(null);
    signIn(provider.id, { callbackUrl: redirectTo }).catch(() => {
      setOauthPending(null);
      setFormError("Unable to sign in.");
    });
  }

  const busy = pending || oauthPending !== null;

  return (
    <>
      {/* Session Status */}
      <AuthSessionStatus className="mb-4 text-xs" status={status} />
      <InputError className="mb-4 text-xs" messages={formError} />

      {/* Login Form */}
      <form ref={formRef} className="flex flex-col gap-4" onSubmit={onSubmit}>
        {/* Username or Email */}
        <div className="flex flex-col">
          <InputLabel htmlFor="id_user" value="Username or Email" />
          <TextInput
            icon={UserRound}
            id="id_user"
            name="id_user"
            type="text"
            required
            autoFocus
            autoComplete="username"
            placeholder="username or email"
            isError={Boolean(errors.id_user)}
          />
          <InputError messages={errors.id_user} className="mt-1" />
        </div>

        {/* Password */}
        <div className="flex flex-col">
          <InputLabel htmlFor="password" value="Password" />
          <PasswordInput
            icon={Lock}
            id="password"
            name="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            isError={Boolean(errors.password)}
          />
          <InputError messages={errors.password} className="mt-1" />
        </div>

        {/* Remember Me & Forgot Password */}
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-foreground" htmlFor="remember_me">
            <input
              className="h-3.5 w-3.5 cursor-pointer rounded-[3px] border-[1.5px] border-border accent-primary"
              id="remember_me"
              name="remember"
              type="checkbox"
            />
            <span>Remember Me</span>
          </label>
          <Link
            className="text-[0.75rem] font-semibold text-primary transition-colors duration-200 hover:text-accent hover:underline"
            href="/forgot-password"
          >
            Forgot Password?
          </Link>
        </div>

        {/* Submit Button */}
        <ButtonPrimary className="group mt-3 w-full" type="submit" disabled={busy}>
          Log in
          {pending ? (
            <LoaderCircle className="size-[1.05rem] animate-spin" aria-hidden="true" />
          ) : (
            <CircleArrowRight
              className="size-[1.05rem] transition-transform duration-200 group-hover:translate-x-[3px]"
              aria-hidden="true"
            />
          )}
        </ButtonPrimary>
      </form>

      {providers.length > 0 ? (
        <div className="mt-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-[1px] flex-1 bg-border"></div>
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-base-content-muted">or continue with</span>
            <div className="h-[1px] flex-1 bg-border"></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {providers.map((provider) => (
              <ButtonLight
                key={provider.id}
                size="small"
                className="min-w-[6.5rem] flex-1"
                onClick={() => continueWith(provider)}
                disabled={busy}
                aria-label={`Continue with ${provider.name}`}
              >
                {/* Lucide has no brand logos, so every provider gets the same sign-in icon next to its name. */}
                {oauthPending === provider.id ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="size-3.5" aria-hidden="true" />
                )}
                <span>{provider.name}</span>
              </ButtonLight>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
