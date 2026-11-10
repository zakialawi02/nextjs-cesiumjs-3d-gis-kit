"use client";

import { CircleAlert, LoaderCircle, Mail, Send } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";

import { GENERIC_ERROR, rethrowNavigationError } from "@/components/app/action-helpers";
import { ButtonPrimary } from "@/components/app/buttons";
import { AuthSessionStatus, InputError, InputLabel, TextInput } from "@/components/app/form-fields";
import { toast } from "@/lib/client/toast";

import { sendPasswordResetLinkAction } from "./actions";

export function ForgotPasswordForm({ mailEnabled }: { mailEnabled: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      try {
        const result = await sendPasswordResetLinkAction(data);
        if (result.ok) {
          setErrors(undefined);
          setStatus(result.message);
          toast.success(result.message);
          form.reset();
        } else {
          setStatus(null);
          setErrors(result.errors?.email ?? (result.message ? [result.message] : undefined));
        }
      } catch (error) {
        rethrowNavigationError(error);
        setErrors([GENERIC_ERROR]);
      }
    });
  }

  return (
    <>
      {/* Session Status */}
      <AuthSessionStatus className="mb-6" status={status} />

      {/* Email Status Warning if SMTP is off */}
      {!mailEnabled ? (
        <div className="mb-6 flex items-center justify-center gap-2 rounded-lg border border-warning/20 bg-warning/10 p-4 text-center text-xs font-medium text-warning">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Email system is unavailable. Please contact admin manually.</span>
        </div>
      ) : null}

      <form className="space-y-5" onSubmit={onSubmit}>
        {/* Email Address */}
        <div className="flex flex-col">
          <InputLabel htmlFor="email" value="Email Address" />
          <TextInput
            icon={Mail}
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="username"
            placeholder="example@mail.com"
            isError={Boolean(errors)}
            disabled={!mailEnabled}
          />
          <InputError messages={errors} className="mt-1" />
        </div>

        {/* Submit Button */}
        <ButtonPrimary className="group w-full" type="submit" disabled={!mailEnabled || pending}>
          Send Reset Link
          {pending ? (
            <LoaderCircle className="size-[1.05rem] animate-spin" aria-hidden="true" />
          ) : (
            <Send
              className="size-[1.05rem] transition-transform duration-250 group-hover:translate-x-[3px]"
              aria-hidden="true"
            />
          )}
        </ButtonPrimary>
      </form>
    </>
  );
}
