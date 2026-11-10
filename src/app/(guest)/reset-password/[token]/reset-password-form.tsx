"use client";

import { LoaderCircle, Lock, LockKeyhole, Mail, RotateCcw } from "lucide-react";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { GENERIC_ERROR, rethrowNavigationError } from "@/components/app/action-helpers";
import { ButtonPrimary } from "@/components/app/buttons";
import { InputError, InputLabel, TextInput } from "@/components/app/form-fields";
import { PasswordInput } from "@/components/app/password-input";
import type { FieldErrors } from "@/server/dashboard/validation";

import { resetPasswordAction } from "./actions";

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  function clearPasswords() {
    for (const name of ["password", "password_confirmation"]) {
      const field = formRef.current?.elements.namedItem(name);
      if (field instanceof HTMLInputElement) field.value = "";
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        // On success the action redirects to /login (with a status toast).
        const result = await resetPasswordAction(data);
        if (!result.ok) {
          setErrors(result.errors ?? { email: [result.message ?? GENERIC_ERROR] });
          clearPasswords();
        }
      } catch (error) {
        rethrowNavigationError(error);
        setErrors({ email: [GENERIC_ERROR] });
      }
    });
  }

  // The token is part of the URL; its validation errors are reported with the email field.
  const emailErrors = [...(errors.email ?? []), ...(errors.token ?? [])];

  return (
    <form ref={formRef} className="space-y-4" onSubmit={onSubmit}>
      {/* Password Reset Token */}
      <input name="token" type="hidden" value={token} />

      {/* Email Address */}
      <div className="flex flex-col">
        <InputLabel htmlFor="email" value="Email Address" />
        <TextInput
          icon={Mail}
          id="email"
          name="email"
          type="email"
          defaultValue={email}
          required
          autoFocus
          autoComplete="username"
          placeholder="name@mail.com"
          isError={emailErrors.length > 0}
        />
        <InputError messages={emailErrors} className="mt-1" />
      </div>

      {/* Password */}
      <div className="flex flex-col">
        <InputLabel htmlFor="password" value="New Password" />
        <PasswordInput
          icon={Lock}
          id="password"
          name="password"
          required
          autoComplete="new-password"
          placeholder="••••••••"
          isError={Boolean(errors.password)}
        />
        <InputError messages={errors.password} className="mt-1" />
      </div>

      {/* Confirm Password */}
      <div className="flex flex-col">
        <InputLabel htmlFor="password_confirmation" value="Confirm Password" />
        <PasswordInput
          icon={LockKeyhole}
          id="password_confirmation"
          name="password_confirmation"
          required
          autoComplete="new-password"
          placeholder="••••••••"
          isError={Boolean(errors.password_confirmation)}
        />
        <InputError messages={errors.password_confirmation} className="mt-1" />
      </div>

      {/* Submit Button */}
      <ButtonPrimary className="group w-full" type="submit" disabled={pending}>
        Reset Password
        {pending ? (
          <LoaderCircle className="size-[1.05rem] animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw
            className="size-[1.05rem] transition-transform duration-250 group-hover:translate-x-[3px]"
            aria-hidden="true"
          />
        )}
      </ButtonPrimary>
    </form>
  );
}
