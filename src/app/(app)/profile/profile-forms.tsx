"use client";

import { AtSign, KeyRound, LoaderCircle, Lock, LockKeyhole, Mail, Save, UserRound } from "lucide-react";
import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";

import { GENERIC_ERROR, rethrowNavigationError } from "@/components/app/action-helpers";
import { ButtonPrimary } from "@/components/app/buttons";
import { InputError, InputLabel, TextInput } from "@/components/app/form-fields";
import { toast } from "@/lib/client/toast";
import type { ActionResult, FieldErrors } from "@/server/dashboard/validation";

import { updatePasswordAction, updateProfileAction } from "./actions";

/** Submits `data` to a Server Action and reports the result (toast + field errors). */
function useActionForm(action: (data: FormData) => Promise<ActionResult>) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  function run(data: FormData, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        const result = await action(data);
        if (result.ok) {
          setErrors({});
          toast.success(result.message);
          onSuccess?.();
        } else {
          setErrors(result.errors ?? {});
          if (result.message) toast.error(result.message);
        }
      } catch (error) {
        rethrowNavigationError(error);
        toast.error(GENERIC_ERROR);
      }
    });
  }

  return { errors, pending, run };
}

export function ProfileForm({ defaults }: { defaults: { name: string; username: string; email: string } }) {
  const [values, setValues] = useState(defaults);
  const { errors, pending, run } = useActionForm(updateProfileAction);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(new FormData(event.currentTarget));
  }

  const change = (field: keyof typeof values) => (event: ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  return (
    <form className="space-y-5 p-6" onSubmit={onSubmit}>
      <div>
        <InputLabel htmlFor="name" value="Name" />
        <TextInput
          id="name"
          name="name"
          type="text"
          icon={UserRound}
          required
          autoComplete="name"
          value={values.name}
          onChange={change("name")}
          isError={Boolean(errors.name)}
        />
        <InputError messages={errors.name} className="mt-1" />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <InputLabel htmlFor="username" value="Username" />
          <TextInput
            id="username"
            name="username"
            type="text"
            icon={AtSign}
            required
            autoComplete="username"
            value={values.username}
            onChange={change("username")}
            isError={Boolean(errors.username)}
          />
          <InputError messages={errors.username} className="mt-1" />
        </div>
        <div>
          <InputLabel htmlFor="email" value="Email" />
          <TextInput
            id="email"
            name="email"
            type="email"
            icon={Mail}
            required
            autoComplete="email"
            value={values.email}
            onChange={change("email")}
            isError={Boolean(errors.email)}
          />
          <InputError messages={errors.email} className="mt-1" />
        </div>
      </div>

      <div className="flex justify-end">
        <ButtonPrimary type="submit" className="text-sm" disabled={pending}>
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}{" "}
          Save Profile
        </ButtonPrimary>
      </div>
    </form>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const { errors, pending, run } = useActionForm(updatePasswordAction);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    run(new FormData(form), () => form.reset());
  }

  return (
    <form className="space-y-5 p-6" onSubmit={onSubmit}>
      {hasPassword ? (
        <div>
          <InputLabel htmlFor="current_password" value="Current Password" />
          <TextInput
            id="current_password"
            name="current_password"
            type="password"
            icon={Lock}
            required
            autoComplete="current-password"
            isError={Boolean(errors.current_password)}
          />
          <InputError messages={errors.current_password} className="mt-1" />
        </div>
      ) : (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-foreground/70">
          No password is set for this account yet. Set one to also sign in with your username or email.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <InputLabel htmlFor="password" value="New Password" />
          <TextInput
            id="password"
            name="password"
            type="password"
            icon={LockKeyhole}
            required
            autoComplete="new-password"
            isError={Boolean(errors.password)}
          />
          <InputError messages={errors.password} className="mt-1" />
        </div>
        <div>
          <InputLabel htmlFor="password_confirmation" value="Confirm Password" />
          <TextInput
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            icon={LockKeyhole}
            required
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <ButtonPrimary type="submit" className="text-sm" disabled={pending}>
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="size-3.5" aria-hidden="true" />
          )}{" "}
          Change Password
        </ButtonPrimary>
      </div>
    </form>
  );
}
